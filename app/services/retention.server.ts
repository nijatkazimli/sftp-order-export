import type { PrismaClient } from "@prisma/client";
import { EXPORT_HISTORY_RETENTION_DAYS } from "./exportQueue.constants";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;
let lastPrune = 0;

/** Deletes expired export history for all shops, at most once an hour per process. */
export async function pruneExportJobs(
  db: PrismaClient,
  now = new Date(),
): Promise<void> {
  if (now.getTime() - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now.getTime();
  const cutoff = new Date(
    now.getTime() - EXPORT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  await db.exportJob.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
