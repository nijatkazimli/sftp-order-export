import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { allow } from "./rateLimit.server";

describe("allow", () => {
  it("allows up to the limit and rejects beyond it", async () => {
    const db = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ count: 3 }])
        .mockResolvedValueOnce([{ count: 4 }]),
    } as unknown as PrismaClient;
    expect(await allow(db, "k", 3)).toBe(true);
    expect(await allow(db, "k", 3)).toBe(false);
  });
});

// Runs the real SQL. Set TEST_DATABASE_URL to a migrated database to enable it.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("allow (against Postgres)", () => {
  const dbs: PrismaClient[] = [];
  const connect = () => {
    const client = new PrismaClient({ datasourceUrl: url });
    dbs.push(client);
    return client;
  };
  const key = () => `test-${randomUUID()}`;
  let db: PrismaClient;

  beforeAll(() => {
    db = connect();
  });
  afterEach(() => db.rateLimit.deleteMany({ where: { key: { startsWith: "test-" } } }));
  afterAll(() => Promise.all(dbs.map((client) => client.$disconnect())));

  it("blocks after the limit within the window", async () => {
    const k = key();
    const t0 = new Date("2030-01-01T00:00:00Z");
    for (let i = 0; i < 3; i++) expect(await allow(db, k, 3, 1000, t0)).toBe(true);
    expect(await allow(db, k, 3, 1000, new Date(t0.getTime() + 500))).toBe(false);
  });

  it("allows again once the window has passed, and the old window is not extended", async () => {
    const k = key();
    const t0 = new Date("2030-01-01T00:00:00Z");
    for (let i = 0; i < 2; i++) await allow(db, k, 2, 1000, t0);
    expect(await allow(db, k, 2, 1000, new Date(t0.getTime() + 999))).toBe(false);
    expect(await allow(db, k, 2, 1000, new Date(t0.getTime() + 1001))).toBe(true);
  });

  it("tracks keys independently", async () => {
    await allow(db, key(), 1);
    expect(await allow(db, key(), 1)).toBe(true);
  });

  it("is exact under concurrency and across separate connections (as with several machines)", async () => {
    const k = key();
    const others = [connect(), connect()];
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => allow([db, ...others][i % 3], k, 10, 60_000)),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });
});
