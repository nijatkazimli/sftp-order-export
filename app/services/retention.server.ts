import type { PrismaClient } from "@prisma/client";
import { EXPORT_HISTORY_RETENTION_DAYS, RETRY_WINDOW_DAYS } from "./exportQueue.constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPrune = 0;

/**
 * At most once an hour per process: drops files that outlived the retry window (e.g. a stuck
 * job) and deletes expired export history for all shops.
 */
export async function pruneExportJobs(
  db: PrismaClient,
  now = new Date(),
): Promise<void> {
  if (now.getTime() - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now.getTime();
  await db.exportJob.updateMany({
    where: {
      payloadEncrypted: { not: null },
      createdAt: { lt: new Date(now.getTime() - RETRY_WINDOW_DAYS * DAY_MS) },
    },
    data: {
      status: "failed",
      lastError: "Not delivered within the retry window",
      payloadEncrypted: null,
      payloadIv: null,
    },
  });
  const cutoff = new Date(now.getTime() - EXPORT_HISTORY_RETENTION_DAYS * DAY_MS);
  await db.exportJob.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
