import type { PrismaClient } from "@prisma/client";
import { decrypt, encrypt, isCurrentKey } from "../utils/crypto.server";
import { open, seal, sealedWithCurrentKey } from "./sessionStorage.server";

export interface RotationReport {
  /** Values re-encrypted with the current key. */
  rewritten: number;
  /** Values that were already on the current key. */
  current: number;
  /** Rows that could not be read with either key, or were changed while rotating. */
  failed: string[];
}

const jobAad = (id: string) => `export-job:${id}`;

/**
 * Re-encrypts everything stored under ENCRYPTION_KEY_PREVIOUS with ENCRYPTION_KEY. Safe to re-run
 * and to run against a live app: each write only applies if the row is still as it was read.
 */
export async function rotateKeys(db: PrismaClient): Promise<RotationReport> {
  const report: RotationReport = { rewritten: 0, current: 0, failed: [] };

  // `write` returns "current" if nothing was needed, the rows updated (0 = lost a race), or throws if unreadable.
  const rotate = async (
    label: string,
    write: () => Promise<number | "current">,
  ) => {
    try {
      const result = await write();
      if (result === "current") report.current++;
      else if (result === 0)
        report.failed.push(`${label} (changed while rotating, run again)`);
      else report.rewritten++;
    } catch {
      report.failed.push(`${label} (unreadable with either key)`);
    }
  };

  const configs = await db.merchantConfig.findMany();
  for (const row of configs) {
    const columns = [
      { enc: "sftpPasswordEncrypted", iv: "sftpIv" },
      { enc: "sftpPrivateKeyEncrypted", iv: "sftpKeyIv" },
    ] as const;
    for (const { enc, iv } of columns) {
      const [encrypted, ivValue] = [row[enc], row[iv]];
      if (!encrypted || !ivValue) continue;
      const value = { encrypted, iv: ivValue };
      await rotate(`config ${row.shop}`, async () => {
        if (isCurrentKey(value, row.shop)) return "current";
        const fresh = encrypt(decrypt(value, row.shop), row.shop);
        const { count } = await db.merchantConfig.updateMany({
          where: { id: row.id, [enc]: encrypted },
          data: { [enc]: fresh.encrypted, [iv]: fresh.iv },
        });
        return count;
      });
    }
  }

  const jobs = await db.exportJob.findMany({
    where: { payloadEncrypted: { not: null }, payloadIv: { not: null } },
    select: { id: true, payloadEncrypted: true, payloadIv: true },
  });
  for (const job of jobs) {
    const value = { encrypted: job.payloadEncrypted!, iv: job.payloadIv! };
    await rotate(`export job ${job.id}`, async () => {
      if (isCurrentKey(value, jobAad(job.id))) return "current";
      const fresh = encrypt(decrypt(value, jobAad(job.id)), jobAad(job.id));
      const { count } = await db.exportJob.updateMany({
        where: { id: job.id, payloadEncrypted: value.encrypted },
        data: { payloadEncrypted: fresh.encrypted, payloadIv: fresh.iv },
      });
      return count;
    });
  }

  const sessions = await db.session.findMany({
    select: { id: true, accessToken: true, refreshToken: true },
  });
  for (const session of sessions) {
    await rotate(`session ${session.id}`, async () => {
      const stale = (token: string | null) =>
        !!token && !sealedWithCurrentKey(token, session.id);
      if (!stale(session.accessToken) && !stale(session.refreshToken))
        return "current";
      const reseal = (token: string | null) =>
        token && stale(token)
          ? seal(open(token, session.id), session.id)
          : token;
      const { count } = await db.session.updateMany({
        where: {
          id: session.id,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        },
        data: {
          accessToken: reseal(session.accessToken)!,
          refreshToken: reseal(session.refreshToken),
        },
      });
      return count;
    });
  }

  return report;
}
