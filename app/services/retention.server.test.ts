import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { EXPORT_HISTORY_RETENTION_DAYS, RETRY_WINDOW_DAYS } from "./exportQueue.constants";
import { pruneExportJobs } from "./retention.server";

const DAY = 24 * 60 * 60 * 1000;

const fakeDb = () => {
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  const rateLimitDelete = vi.fn().mockResolvedValue({ count: 0 });
  return {
    db: {
      exportJob: { deleteMany, updateMany },
      rateLimit: { deleteMany: rateLimitDelete },
    } as unknown as PrismaClient,
    deleteMany,
    updateMany,
    rateLimitDelete,
  };
};

describe("pruneExportJobs", () => {
  it("deletes entries older than the retention period", async () => {
    const { db, deleteMany } = fakeDb();
    const now = new Date("2030-01-01T00:00:00Z");
    await pruneExportJobs(db, now);
    const cutoff = deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(EXPORT_HISTORY_RETENTION_DAYS * DAY);
  });

  it("drops files still stored after the retry window and marks the export failed", async () => {
    const { db, updateMany } = fakeDb();
    const now = new Date("2030-06-01T00:00:00Z");
    await pruneExportJobs(db, now);
    const { where, data } = updateMany.mock.calls[0][0];
    expect(now.getTime() - (where.createdAt.lt as Date).getTime()).toBe(RETRY_WINDOW_DAYS * DAY);
    expect(where.payloadEncrypted).toEqual({ not: null });
    expect(data).toMatchObject({
      status: "failed",
      payloadEncrypted: null,
      payloadIv: null,
    });
  });

  it("clears rate-limit rows from older than a day", async () => {
    const { db, rateLimitDelete } = fakeDb();
    const now = new Date("2030-09-01T00:00:00Z");
    await pruneExportJobs(db, now);
    const cutoff = rateLimitDelete.mock.calls[0][0].where.windowStart.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(DAY);
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
