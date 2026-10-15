import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { EXPORT_HISTORY_RETENTION_DAYS } from "./exportQueue.constants";
import { pruneExportJobs } from "./retention.server";

const fakeDb = () => {
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  return { db: { exportJob: { deleteMany } } as unknown as PrismaClient, deleteMany };
};

describe("pruneExportJobs", () => {
  it("deletes entries older than the retention period", async () => {
    const { db, deleteMany } = fakeDb();
    const now = new Date("2030-01-01T00:00:00Z");
    await pruneExportJobs(db, now);
    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(
      EXPORT_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it("runs at most once an hour", async () => {
    const { db, deleteMany } = fakeDb();
    await pruneExportJobs(db, new Date("2031-01-01T00:00:00Z"));
    await pruneExportJobs(db, new Date("2031-01-01T00:30:00Z"));
    expect(deleteMany).toHaveBeenCalledTimes(1);
    await pruneExportJobs(db, new Date("2031-01-01T01:30:00Z"));
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});
