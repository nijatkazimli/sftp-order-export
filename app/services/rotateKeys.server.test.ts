import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "../utils/crypto.server";
import { rotateKeys } from "./rotateKeys.server";
import { open, seal } from "./sessionStorage.server";

const KEY_OLD = "ab".repeat(32);
const KEY_NEW = "cd".repeat(32);
const SHOP = "a.myshopify.com";
const SECRET = `secret-${randomUUID()}`;

type Row = Record<string, unknown>;

// updateMany applies only when every `where` field still matches, like the real database.
function table(rows: Row[]) {
  return {
    rows,
    findMany: async () => rows,
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => r[k] === v),
      );
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
}

function fakeDb(seed: { configs?: Row[]; jobs?: Row[]; sessions?: Row[] }) {
  const merchantConfig = table(seed.configs ?? []);
  const exportJob = table(seed.jobs ?? []);
  const session = table(seed.sessions ?? []);
  return {
    merchantConfig,
    exportJob,
    session,
    db: { merchantConfig, exportJob, session } as unknown as PrismaClient,
  };
}

const onOldKey = <T>(fn: () => T) => {
  vi.stubEnv("ENCRYPTION_KEY", KEY_OLD);
  const result = fn();
  vi.stubEnv("ENCRYPTION_KEY", KEY_NEW);
  vi.stubEnv("ENCRYPTION_KEY_PREVIOUS", KEY_OLD);
  return result;
};

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", KEY_NEW));

describe("rotateKeys", () => {
  it("re-encrypts configs, queued files and sessions so the previous key can be dropped", async () => {
    const { db, merchantConfig, exportJob, session } = fakeDb(
      onOldKey(() => {
        const pw = encrypt(SECRET, SHOP);
        const key = encrypt(SECRET, SHOP);
        const file = encrypt(SECRET, "export-job:j1");
        return {
          configs: [
            {
              id: "c1",
              shop: SHOP,
              sftpPasswordEncrypted: pw.encrypted,
              sftpIv: pw.iv,
              sftpPrivateKeyEncrypted: key.encrypted,
              sftpKeyIv: key.iv,
            },
          ],
          jobs: [
            { id: "j1", payloadEncrypted: file.encrypted, payloadIv: file.iv },
          ],
          sessions: [
            {
              id: "s1",
              accessToken: seal(SECRET, "s1"),
              refreshToken: seal(SECRET, "s1"),
            },
          ],
        };
      }),
    );

    const report = await rotateKeys(db);
    expect(report).toEqual({ rewritten: 4, current: 0, failed: [] });

    vi.stubEnv("ENCRYPTION_KEY_PREVIOUS", "");
    const [config] = merchantConfig.rows as Row[];
    expect(
      decrypt(
        {
          encrypted: config.sftpPasswordEncrypted as string,
          iv: config.sftpIv as string,
        },
        SHOP,
      ),
    ).toBe(SECRET);
    expect(
      decrypt(
        {
          encrypted: config.sftpPrivateKeyEncrypted as string,
          iv: config.sftpKeyIv as string,
        },
        SHOP,
      ),
    ).toBe(SECRET);
    const [job] = exportJob.rows as Row[];
    expect(
      decrypt(
        {
          encrypted: job.payloadEncrypted as string,
          iv: job.payloadIv as string,
        },
        "export-job:j1",
      ),
    ).toBe(SECRET);
    const [stored] = session.rows as Row[];
    expect(open(stored.accessToken as string, "s1")).toBe(SECRET);
    expect(open(stored.refreshToken as string, "s1")).toBe(SECRET);
  });

  it("is a no-op the second time", async () => {
    const { db } = fakeDb(
      onOldKey(() => {
        const pw = encrypt(SECRET, SHOP);
        return {
          configs: [
            {
              id: "c1",
              shop: SHOP,
              sftpPasswordEncrypted: pw.encrypted,
              sftpIv: pw.iv,
            },
          ],
        };
      }),
    );
    await rotateKeys(db);
    expect(await rotateKeys(db)).toEqual({
      rewritten: 0,
      current: 1,
      failed: [],
    });
  });

  it("skips empty columns and sessions without a refresh token", async () => {
    const { db } = fakeDb({
      configs: [
        { id: "c1", shop: SHOP, sftpPasswordEncrypted: null, sftpIv: null },
      ],
      jobs: [],
      sessions: [
        { id: "s1", accessToken: seal(SECRET, "s1"), refreshToken: null },
      ],
    });
    expect(await rotateKeys(db)).toEqual({
      rewritten: 0,
      current: 1,
      failed: [],
    });
  });

  it("seals legacy plaintext session tokens", async () => {
    const { db, session } = fakeDb({
      sessions: [{ id: "s1", accessToken: SECRET, refreshToken: null }],
    });
    expect(await rotateKeys(db)).toMatchObject({ rewritten: 1, failed: [] });
    const [stored] = session.rows as Row[];
    expect(stored.accessToken).not.toBe(SECRET);
    expect(open(stored.accessToken as string, "s1")).toBe(SECRET);
  });

  it("reports rows it cannot read, without leaking their contents, and keeps going", async () => {
    const good = onOldKey(() => encrypt(SECRET, SHOP));
    const bad = encrypt(SECRET, "someone-else.myshopify.com");
    const { db } = fakeDb({
      configs: [
        {
          id: "c1",
          shop: SHOP,
          sftpPasswordEncrypted: bad.encrypted,
          sftpIv: bad.iv,
        },
        {
          id: "c2",
          shop: SHOP,
          sftpPasswordEncrypted: good.encrypted,
          sftpIv: good.iv,
        },
      ],
    });
    const report = await rotateKeys(db);
    expect(report.rewritten).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });

  it("does not overwrite a row that changed after it was read", async () => {
    const pw = onOldKey(() => encrypt(SECRET, SHOP));
    const fresh = encrypt("newer", SHOP);
    const { db, merchantConfig } = fakeDb({
      configs: [
        {
          id: "c1",
          shop: SHOP,
          sftpPasswordEncrypted: pw.encrypted,
          sftpIv: pw.iv,
        },
      ],
    });
    const find = merchantConfig.findMany;
    merchantConfig.findMany = async () => {
      const snapshot = (await find()).map((r) => ({ ...r }));
      Object.assign(merchantConfig.rows[0], {
        sftpPasswordEncrypted: fresh.encrypted,
        sftpIv: fresh.iv,
      });
      return snapshot;
    };
    const report = await rotateKeys(db);
    expect(report.rewritten).toBe(0);
    expect(report.failed).toHaveLength(1);
    expect(merchantConfig.rows[0].sftpPasswordEncrypted).toBe(fresh.encrypted);
  });
});
