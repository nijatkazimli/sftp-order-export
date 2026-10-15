import type { ExportJob, MerchantConfig, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.hoisted(() => vi.fn());
vi.mock("./sftp.server", () => ({ uploadCsvToSftp: upload }));

import { RETRY_DELAYS_MS, RETRY_WINDOW_MS } from "./exportQueue.constants";
import {
  claimDueJob,
  enqueueExport,
  processDueJobs,
  retryDelayMs,
  runJob,
} from "./exportQueue.server";
import { encryptCredential } from "./credentials.server";

const SHOP = "a.myshopify.com";
const NOW = new Date("2030-01-01T12:00:00Z");
const order = {
  id: 1001,
  name: "#1001",
  created_at: "2030-01-01T10:00:00Z",
  email: "private-customer@example.com",
  line_items: [{ sku: "S1", title: "Wax", quantity: 1, price: "5.00" }],
};

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  upload.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

function config(overrides: Partial<MerchantConfig> = {}): MerchantConfig {
  return {
    shop: SHOP,
    sftpHost: "sftp.example.com",
    sftpPort: 22,
    sftpUsername: "u",
    targetDirectory: "/upload",
    filenameTemplate: "order-{order}.csv",
    csvColumns: null,
    sftpHostKey: null,
    exportTrigger: "created",
    ...encryptCredential({ method: "password", password: randomUUID() }, SHOP),
    ...overrides,
  } as MerchantConfig;
}

function fakeDb(cfg: MerchantConfig | null = config()) {
  const jobs = new Map<string, Record<string, unknown>>();
  const db = {
    exportJob: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const duplicate = [...jobs.values()].some(
          (j) => j.shop === data.shop && j.orderId === data.orderId,
        );
        if (duplicate) throw Object.assign(new Error("unique"), { code: "P2002" });
        jobs.set(data.id as string, {
          attempts: 0,
          lastError: null,
          payloadEncrypted: null,
          payloadIv: null,
          ...data,
        });
        return data;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          Object.assign(jobs.get(where.id)!, data);
        },
      ),
    },
    merchantConfig: {
      findUnique: vi.fn().mockResolvedValue(cfg),
      update: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn(),
  };
  return { db: db as unknown as PrismaClient, raw: db, jobs };
}

const only = (jobs: Map<string, Record<string, unknown>>) =>
  [...jobs.values()][0] as unknown as ExportJob;

describe("retry schedule", () => {
  it("backs off, then gives up", () => {
    expect(retryDelayMs(1)).toBe(RETRY_DELAYS_MS[0]);
    expect(retryDelayMs(RETRY_DELAYS_MS.length)).toBe(
      RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1],
    );
    expect(retryDelayMs(RETRY_DELAYS_MS.length + 1)).toBeNull();
  });

  it("keeps the whole retry window under two days", () => {
    expect(RETRY_WINDOW_MS).toBeLessThanOrEqual(2 * 24 * 60 * 60 * 1000);
  });
});

describe("enqueueExport", () => {
  it("stores the finished file encrypted, with nothing readable in the row", async () => {
    const { db, jobs } = fakeDb();
    expect(await enqueueExport(db, { shop: SHOP, order, config: config(), now: NOW })).toBe("queued");

    const job = only(jobs);
    expect(job).toMatchObject({ shop: SHOP, orderId: "1001", orderName: "#1001", status: "pending", nextAttemptAt: NOW });
    expect(JSON.stringify(job)).not.toContain("private-customer@example.com");
    expect(JSON.stringify(job)).not.toContain("order-1001.csv");
    expect(job.payloadEncrypted).toBeTruthy();
  });

  it("queues one export per order however often Shopify delivers it", async () => {
    const { db, jobs } = fakeDb();
    expect(await enqueueExport(db, { shop: SHOP, order, config: config() })).toBe("queued");
    expect(await enqueueExport(db, { shop: SHOP, order, config: config() })).toBe("duplicate");
    expect(jobs.size).toBe(1);
  });

  it("records a failed job straight away when the saved columns are invalid", async () => {
    const { db, jobs } = fakeDb();
    const result = await enqueueExport(db, { shop: SHOP, order, config: config({ csvColumns: "nope" }) });
    expect(result).toBe("invalid");
    expect(only(jobs)).toMatchObject({ status: "failed", lastError: 'Unknown column "nope"' });
    expect(only(jobs).payloadEncrypted).toBeNull();
  });

  it("rethrows unexpected database errors so Shopify retries the webhook", async () => {
    const { db, raw } = fakeDb();
    raw.exportJob.create.mockRejectedValueOnce(new Error("db down"));
    await expect(enqueueExport(db, { shop: SHOP, order, config: config() })).rejects.toThrow("db down");
  });
});

describe("runJob", () => {
  async function queued(cfg = config()) {
    const ctx = fakeDb(cfg);
    await enqueueExport(ctx.db, { shop: SHOP, order, config: cfg, now: NOW });
    return { ...ctx, job: only(ctx.jobs) };
  }

  it("uploads the decrypted file, pins the host key and clears the payload", async () => {
    const { db, raw, jobs, job } = await queued();
    upload.mockResolvedValue("sha256:abc");
    await runJob(db, job, { upload, now: () => NOW });

    const [sftp, filename, csv] = upload.mock.calls[0];
    expect(sftp).toMatchObject({ host: "sftp.example.com", username: "u", targetDirectory: "/upload" });
    expect(filename).toBe("order-1001.csv");
    expect(csv).toContain("private-customer@example.com");
    expect(raw.merchantConfig.update).toHaveBeenCalledWith({
      where: { shop: SHOP },
      data: { sftpHostKey: "sha256:abc" },
    });
    expect(only(jobs)).toMatchObject({ status: "success", attempts: 1, lastError: null, payloadEncrypted: null, payloadIv: null });
  });

  it("does not overwrite an already pinned host key", async () => {
    const { db, raw, job } = await queued(config({ sftpHostKey: "sha256:old" }));
    upload.mockResolvedValue("sha256:old");
    await runJob(db, job, { upload, now: () => NOW });
    expect(raw.merchantConfig.update).not.toHaveBeenCalled();
  });

  it("keeps the job pending and schedules a retry when the upload fails", async () => {
    const { db, jobs, job } = await queued();
    upload.mockRejectedValue(new Error("connection refused"));
    await runJob(db, job, { upload, now: () => NOW });

    expect(only(jobs)).toMatchObject({ status: "pending", attempts: 1, lastError: "connection refused" });
    expect(only(jobs).nextAttemptAt).toEqual(new Date(NOW.getTime() + RETRY_DELAYS_MS[0]));
    expect(only(jobs).payloadEncrypted).toBeTruthy();
  });

  it("marks the job failed and deletes the file after the last retry", async () => {
    const { db, jobs, job } = await queued();
    upload.mockRejectedValue(new Error("still down"));
    await runJob(db, { ...job, attempts: RETRY_DELAYS_MS.length }, { upload, now: () => NOW });

    expect(only(jobs)).toMatchObject({ status: "failed", lastError: "still down", payloadEncrypted: null, payloadIv: null });
  });

  it("fails permanently when the store has no SFTP settings", async () => {
    const { db, jobs, job } = await queued();
    (db.merchantConfig.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await runJob(db, job, { upload, now: () => NOW });
    expect(upload).not.toHaveBeenCalled();
    expect(only(jobs)).toMatchObject({ status: "failed", lastError: "No SFTP settings saved", payloadEncrypted: null });
  });

  it("refuses a payload copied onto another job", async () => {
    const { db, jobs, job } = await queued();
    upload.mockResolvedValue("sha256:abc");
    const copy = { ...job, id: "another-job" };
    jobs.set(copy.id, { ...copy });
    await runJob(db, copy, { upload, now: () => NOW });
    expect(upload).not.toHaveBeenCalled();
    expect(jobs.get("another-job")).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("truncates long error messages", async () => {
    const { db, jobs, job } = await queued();
    upload.mockRejectedValue(new Error("x".repeat(2000)));
    await runJob(db, job, { upload, now: () => NOW });
    expect((only(jobs).lastError as string).length).toBe(500);
  });
});

describe("claimDueJob and processDueJobs", () => {
  it("returns null when nothing is due", async () => {
    const { db, raw } = fakeDb();
    raw.$queryRaw.mockResolvedValue([]);
    expect(await claimDueJob(db, NOW)).toBeNull();
  });

  it("processes claimed jobs until none are left", async () => {
    const cfg = config();
    const { db, raw, jobs } = fakeDb(cfg);
    await enqueueExport(db, { shop: SHOP, order, config: cfg, now: NOW });
    upload.mockResolvedValue("sha256:abc");
    raw.$queryRaw.mockResolvedValueOnce([only(jobs)]).mockResolvedValueOnce([]);

    expect(await processDueJobs(db)).toBe(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(only(jobs).status).toBe("success");
  });

  it("survives a job whose outcome cannot be recorded", async () => {
    const cfg = config();
    const { db, raw, jobs } = fakeDb(cfg);
    await enqueueExport(db, { shop: SHOP, order, config: cfg, now: NOW });
    upload.mockResolvedValue("sha256:abc");
    raw.exportJob.update.mockRejectedValue(new Error("db down"));
    raw.$queryRaw.mockResolvedValueOnce([only(jobs)]).mockResolvedValueOnce([]);
    await expect(processDueJobs(db)).resolves.toBe(1);
  });
});
