import { randomUUID } from "node:crypto";
import { Session } from "@shopify/shopify-app-react-router/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EncryptedSessionStorage } from "./sessionStorage.server";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32)));
afterEach(() => vi.unstubAllEnvs());

const ID = "offline_a.myshopify.com";
const SHOP = "a.myshopify.com";
const ACCESS = `token-${randomUUID()}`;
const REFRESH = `refresh-${randomUUID()}`;

function fakeInner() {
  const rows = new Map<string, Session>();
  return {
    rows,
    storeSession: async (s: Session) => (rows.set(s.id, s), true),
    loadSession: async (id: string) => rows.get(id),
    deleteSession: async (id: string) => rows.delete(id),
    deleteSessions: async (ids: string[]) => (ids.forEach((i) => rows.delete(i)), true),
    findSessionsByShop: async (shop: string) =>
      [...rows.values()].filter((s) => s.shop === shop),
    isReady: async () => true,
  };
}

const session = (params: Partial<ConstructorParameters<typeof Session>[0]> = {}) =>
  new Session({
    id: ID,
    shop: SHOP,
    state: "state",
    isOnline: false,
    scope: "read_orders",
    accessToken: ACCESS,
    refreshToken: REFRESH,
    ...params,
  });

describe("EncryptedSessionStorage", () => {
  it("stores tokens encrypted and loads them back", async () => {
    const inner = fakeInner();
    const storage = new EncryptedSessionStorage(inner);
    await storage.storeSession(session());

    const raw = inner.rows.get(ID)!;
    expect(raw.accessToken).toMatch(/^enc:v1:/);
    expect(raw.accessToken).not.toContain(ACCESS);
    expect(raw.refreshToken).not.toContain(REFRESH);
    expect(raw.shop).toBe(SHOP);
    expect(raw.scope).toBe("read_orders");

    const loaded = await storage.loadSession(ID);
    expect(loaded?.accessToken).toBe(ACCESS);
    expect(loaded?.refreshToken).toBe(REFRESH);
  });

  it("reads legacy plaintext sessions", async () => {
    const inner = fakeInner();
    await inner.storeSession(session());
    const loaded = await new EncryptedSessionStorage(inner).loadSession(ID);
    expect(loaded?.accessToken).toBe(ACCESS);
  });

  it("treats an undecryptable session as missing", async () => {
    const inner = fakeInner();
    await new EncryptedSessionStorage(inner).storeSession(session());
    vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32));
    const storage = new EncryptedSessionStorage(inner);
    expect(await storage.loadSession(ID)).toBeUndefined();
    expect(await storage.findSessionsByShop(SHOP)).toEqual([]);
  });

  it("decrypts sessions found by shop and delegates deletes", async () => {
    const inner = fakeInner();
    const storage = new EncryptedSessionStorage(inner);
    await storage.storeSession(session());
    const [found] = await storage.findSessionsByShop(SHOP);
    expect(found.accessToken).toBe(ACCESS);
    await storage.deleteSession(ID);
    expect(inner.rows.size).toBe(0);
  });

  it("keeps sessions without a refresh token intact", async () => {
    const inner = fakeInner();
    const storage = new EncryptedSessionStorage(inner);
    await storage.storeSession(session({ id: "s", refreshToken: undefined }));
    const loaded = await storage.loadSession("s");
    expect(loaded?.accessToken).toBe(ACCESS);
    expect(loaded?.refreshToken).toBeUndefined();
  });
});
