import { randomUUID } from "node:crypto";
import type { ExportJob, MerchantConfig, PrismaClient } from "@prisma/client";
import { decrypt, encrypt } from "../utils/crypto.server";
import { toSftpConfig } from "./credentials.server";
import { RETRY_DELAYS_MS } from "./exportQueue.constants";
import {
  orderToCsv,
  parseColumnSpec,
  renderFilename,
  type ShopifyOrderPayload,
} from "./orderCsv.server";
import { uploadCsvToSftp } from "./sftp.server";

const MINUTE = 60_000;

/** A claimed job that is never finished (crash) becomes due again after this long. */
const LEASE_MS = 5 * MINUTE;

const jobAad = (id: string) => `export-job:${id}`;

/** Delay before the next attempt after `attempts` failures, or null to give up. */
export function retryDelayMs(attempts: number): number | null {
  return RETRY_DELAYS_MS[attempts - 1] ?? null;
}

type EnqueueResult = "queued" | "duplicate" | "invalid";

/**
 * Builds the file now and stores it encrypted until it is delivered, so a slow
 * or unreachable SFTP server never holds up Shopify's webhook delivery.
 */
export async function enqueueExport(
  db: PrismaClient,
  {
    shop,
    order,
    config,
    now = new Date(),
  }: {
    shop: string;
    order: ShopifyOrderPayload;
    config: Pick<MerchantConfig, "csvColumns" | "filenameTemplate">;
    now?: Date;
  },
): Promise<EnqueueResult> {
  const id = randomUUID();
  const base = {
    id,
    shop,
    orderId: String(order.id),
    orderName: order.name ?? String(order.id),
    nextAttemptAt: now,
  };

  const parsed = parseColumnSpec(config.csvColumns);
  const data =
    "error" in parsed
      ? { ...base, status: "failed", lastError: parsed.error }
      : {
          ...base,
          status: "pending",
          ...toPayload(
            id,
            renderFilename(config.filenameTemplate, order),
            orderToCsv(order, parsed.columns),
          ),
        };

  try {
    await db.exportJob.create({ data });
  } catch (error) {
    // One export per order, however many times Shopify delivers the webhook.
    if ((error as { code?: string }).code === "P2002") return "duplicate";
    throw error;
  }
  return "error" in parsed ? "invalid" : "queued";
}

function toPayload(id: string, filename: string, csv: string) {
  const { encrypted, iv } = encrypt(JSON.stringify({ filename, csv }), jobAad(id));
  return { payloadEncrypted: encrypted, payloadIv: iv };
}

/** Atomically takes the next due job and pushes its due time out, so no other worker takes it. */
export async function claimDueJob(
  db: PrismaClient,
  now = new Date(),
): Promise<ExportJob | null> {
  const lease = new Date(now.getTime() + LEASE_MS);
  const rows = await db.$queryRaw<ExportJob[]>`
    UPDATE "ExportJob"
    SET "nextAttemptAt" = ${lease}, "updatedAt" = ${now}
    WHERE "id" = (
      SELECT "id" FROM "ExportJob"
      WHERE "status" = 'pending' AND "nextAttemptAt" <= ${now}
      ORDER BY "nextAttemptAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
  return rows[0] ?? null;
}

interface RunDeps {
  upload: typeof uploadCsvToSftp;
  now: () => Date;
}

const defaultDeps: RunDeps = { upload: uploadCsvToSftp, now: () => new Date() };

const CLEARED = { payloadEncrypted: null, payloadIv: null };

/** Delivers one claimed job and records the outcome. */
export async function runJob(
  db: PrismaClient,
  job: ExportJob,
  deps: RunDeps = defaultDeps,
): Promise<void> {
  const attempts = job.attempts + 1;
  const finish = (data: Parameters<PrismaClient["exportJob"]["update"]>[0]["data"]) =>
    db.exportJob.update({ where: { id: job.id }, data });

  try {
    const config = await db.merchantConfig.findUnique({ where: { shop: job.shop } });
    if (!config) {
      await finish({ status: "failed", attempts, lastError: "No SFTP settings saved", ...CLEARED });
      return;
    }
    if (!job.payloadEncrypted || !job.payloadIv) {
      await finish({ status: "failed", attempts, lastError: "Export file is missing", ...CLEARED });
      return;
    }

    const { filename, csv } = JSON.parse(
      decrypt({ encrypted: job.payloadEncrypted, iv: job.payloadIv }, jobAad(job.id)),
    ) as { filename: string; csv: string };
    const hostKey = await deps.upload(toSftpConfig(config), filename, csv);

    // Trust on first use: remember the key so a changed one is refused later.
    if (!config.sftpHostKey && hostKey) {
      await db.merchantConfig
        .update({ where: { shop: job.shop }, data: { sftpHostKey: hostKey } })
        .catch((e) => console.error("Failed to store host key", e));
    }
    await finish({ status: "success", attempts, lastError: null, ...CLEARED });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Unknown error").slice(0, 500);
    const delay = retryDelayMs(attempts);
    console.error(`Export ${job.id} for ${job.shop} failed (attempt ${attempts})`, error);
    await (delay === null
      ? finish({ status: "failed", attempts, lastError: message, ...CLEARED })
      : finish({
          attempts,
          lastError: message,
          nextAttemptAt: new Date(deps.now().getTime() + delay),
        }));
  }
}

/** Processes due jobs until none are left (or `limit` is reached). */
export async function processDueJobs(db: PrismaClient, limit = 25): Promise<number> {
  let processed = 0;
  while (processed < limit) {
    const job = await claimDueJob(db);
    if (!job) break;
    try {
      await runJob(db, job);
    } catch (error) {
      // Leave it; the lease expires and it becomes due again.
      console.error(`Could not record the outcome of export ${job.id}`, error);
    }
    processed++;
  }
  return processed;
}
