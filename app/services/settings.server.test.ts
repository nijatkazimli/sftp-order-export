import type { MerchantConfig, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sftp = vi.hoisted(() => ({ test: vi.fn() }));
vi.mock("./sftp.server", () => ({ testSftpConnection: sftp.test }));

import { encryptCredential } from "./credentials.server";
import { DEFAULT_COLUMN_SPEC } from "./orderCsv.server";
import { loadSettingsView, submitSettings } from "./settings.server";

const PASSWORD = randomUUID();
const STORED_PASSWORD = randomUUID();
let shopCounter = 0;
// The connection-test rate limit is per shop, so every test gets its own.
const newShop = () => `shop-${++shopCounter}.myshopify.com`;

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  sftp.test.mockReset();
  sftp.test.mockResolvedValue({ ok: true, hostKey: "sha256:new" });
});
afterEach(() => vi.unstubAllEnvs());

const BASE = {
  intent: "save",
  host: "sftp.example.com",
  port: "22",
  username: "u",
  password: PASSWORD,
  targetDirectory: "/upload",
};

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...BASE, ...fields })) data.set(key, value);
  return data;
}

function stored(shop: string, overrides: Partial<MerchantConfig> = {}): MerchantConfig {
  return {
    shop,
    sftpHost: "sftp.example.com",
    sftpPort: 22,
    sftpUsername: "u",
    targetDirectory: "/upload",
    filenameTemplate: "order-{order}.csv",
    csvColumns: null,
    sftpHostKey: null,
    exportTrigger: "created",
    ...encryptCredential({ method: "password", password: STORED_PASSWORD }, shop),
    ...overrides,
  } as MerchantConfig;
}

function fakeDb(config: MerchantConfig | null = null) {
  const raw = {
    merchantConfig: {
      findUnique: vi.fn().mockResolvedValue(config),
      update: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
    },
    exportJob: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { db: raw as unknown as PrismaClient, raw };
}

const run = (shop: string, config: MerchantConfig | null, fields: Record<string, string> = {}) => {
  const ctx = fakeDb(config);
  return { ...ctx, result: submitSettings(ctx.db, shop, form(fields)) };
};

describe("loadSettingsView", () => {
  it("returns defaults for a store without settings", async () => {
    const { db } = fakeDb();
    const view = await loadSettingsView(db, newShop());
    expect(view).toMatchObject({
      host: "",
      port: 22,
      username: "",
      targetDirectory: "/upload",
      filenameTemplate: "order-{order}.csv",
      exportTrigger: "created",
      csvColumns: DEFAULT_COLUMN_SPEC,
      authMethod: "password",
      hasCredential: false,
      hostKey: null,
      exports: [],
    });
  });

  it("shows saved settings and recent exports but never a secret", async () => {
    const shop = newShop();
    const config = stored(shop, { sftpHostKey: "sha256:abc", exportTrigger: "paid" });
    const { db, raw } = fakeDb(config);
    raw.exportJob.findMany.mockResolvedValue([
      { id: "j1", orderName: "#1", status: "pending", attempts: 2, lastError: "boom", createdAt: new Date("2030-01-01T10:00:00Z") },
    ]);
    const view = await loadSettingsView(db, shop);

    expect(view).toMatchObject({ host: "sftp.example.com", hasCredential: true, hostKey: "sha256:abc", exportTrigger: "paid" });
    expect(view.exports).toEqual([
      { id: "j1", orderName: "#1", status: "pending", attempts: 2, error: "boom", createdAt: "2030-01-01T10:00:00.000Z" },
    ]);
    const json = JSON.stringify(view);
    expect(json).not.toContain(STORED_PASSWORD);
    expect(json).not.toContain(config.sftpPasswordEncrypted as string);
    expect(raw.exportJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shop }, take: 20 }));
  });
});

describe("submitSettings: input validation", () => {
  it.each([
    [{ host: " " }, "Host, username and target path are required."],
    [{ username: "" }, "Host, username and target path are required."],
    [{ targetDirectory: "" }, "Host, username and target path are required."],
    [{ port: "0" }, "Port must be between 1 and 65535."],
    [{ port: "65536" }, "Port must be between 1 and 65535."],
    [{ port: "22.5" }, "Port must be between 1 and 65535."],
    [{ port: "abc" }, "Port must be between 1 and 65535."],
  ])("rejects %j", async (fields, message) => {
    const { result, raw } = run(newShop(), null, fields);
    expect(await result).toEqual({ ok: false, message });
    expect(raw.merchantConfig.findUnique).not.toHaveBeenCalled();
    expect(sftp.test).not.toHaveBeenCalled();
  });

  it("rejects an unknown action once the credentials are valid", async () => {
    expect(await run(newShop(), null, { intent: "bogus" }).result).toEqual({ ok: false, message: "Unknown action." });
  });
});

describe("submitSettings: credentials", () => {
  it("requires a password for a store without saved settings", async () => {
    const { result } = run(newShop(), null, { password: "", intent: "test" });
    expect(await result).toEqual({ ok: false, message: "The password is required." });
    expect(sftp.test).not.toHaveBeenCalled();
  });

  it("reuses the saved password when the field is blank and the server is unchanged", async () => {
    const shop = newShop();
    await run(shop, stored(shop), { password: "", intent: "test" }).result;
    expect(sftp.test).toHaveBeenCalledWith(expect.objectContaining({ password: STORED_PASSWORD }));
  });

  it.each([
    [{ host: "other.example.com" }],
    [{ port: "2222" }],
    [{ username: "root" }],
  ])("never sends the saved password to a changed server (%j)", async (fields) => {
    const shop = newShop();
    const result = await run(shop, stored(shop), { password: "", intent: "test", ...fields }).result;
    expect(result).toEqual({ ok: false, message: "Enter the password again when the host, port or username changes." });
    expect(sftp.test).not.toHaveBeenCalled();
  });

  it("uses a newly typed password for a changed server", async () => {
    const shop = newShop();
    await run(shop, stored(shop), { host: "other.example.com", intent: "test" }).result;
    expect(sftp.test).toHaveBeenCalledWith(expect.objectContaining({ host: "other.example.com", password: PASSWORD }));
  });

  it("asks for the key when switching from a saved password to a private key", async () => {
    const shop = newShop();
    const result = await run(shop, stored(shop), { authMethod: "privateKey", password: "", intent: "test" }).result;
    expect(result).toEqual({ ok: false, message: "The private key is required." });
  });

  it.each([
    ["text without the marker", "not a key"],
    ["a key longer than 16 KB", `PRIVATE KEY${"x".repeat(16_400)}`],
  ])("rejects %s", async (_label, privateKey) => {
    const result = await run(newShop(), null, { authMethod: "privateKey", privateKey, intent: "test" }).result;
    expect(result).toEqual({ ok: false, message: "Paste a valid private key (PEM format)." });
  });

  it("accepts a private key with an optional passphrase", async () => {
    const keyText = "body PRIVATE KEY body";
    const passphrase = randomUUID();
    await run(newShop(), null, { authMethod: "privateKey", privateKey: ` ${keyText} `, passphrase, intent: "test" }).result;
    expect(sftp.test).toHaveBeenCalledWith(expect.objectContaining({ privateKey: `${keyText}\n`, passphrase }));

    sftp.test.mockClear();
    await run(newShop(), null, { authMethod: "privateKey", privateKey: keyText, intent: "test" }).result;
    expect(sftp.test).toHaveBeenCalledWith(expect.objectContaining({ passphrase: undefined }));
  });

  it("reuses a saved private key when the field is blank", async () => {
    const shop = newShop();
    const config = stored(shop, encryptCredential({ method: "privateKey", privateKey: "SAVED PRIVATE KEY\n" }, shop));
    await run(shop, { ...config, authMethod: "privateKey" }, { authMethod: "privateKey", password: "", intent: "test" }).result;
    expect(sftp.test).toHaveBeenCalledWith(expect.objectContaining({ privateKey: "SAVED PRIVATE KEY\n" }));
  });

  it("asks for the secret again when the saved one cannot be decrypted", async () => {
    const shop = newShop();
    const config = stored(shop);
    vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32));
    const result = await run(shop, config, { password: "", intent: "test" }).result;
    expect(result).toEqual({ ok: false, message: "The password is required." });
  });
});

describe("submitSettings: test connection", () => {
  it("reports success and failure", async () => {
    expect(await run(newShop(), null, { intent: "test" }).result).toEqual({ ok: true, message: "Connection successful." });

    sftp.test.mockResolvedValue({ ok: false, error: "auth failed" });
    expect(await run(newShop(), null, { intent: "test" }).result).toEqual({ ok: false, message: "Connection failed: auth failed" });
  });

  it("enforces the pinned host key only for the saved server", async () => {
    const shop = newShop();
    const config = stored(shop, { sftpHostKey: "sha256:pinned" });
    await run(shop, config, { intent: "test" }).result;
    expect(sftp.test).toHaveBeenLastCalledWith(expect.objectContaining({ expectedHostKey: "sha256:pinned" }));

    await run(shop, config, { intent: "test", host: "other.example.com" }).result;
    expect(sftp.test).toHaveBeenLastCalledWith(expect.objectContaining({ expectedHostKey: undefined }));
  });

  it("pins the host key on the first successful test of a saved server", async () => {
    const shop = newShop();
    const { result, raw } = run(shop, stored(shop), { intent: "test" });
    await result;
    expect(raw.merchantConfig.update).toHaveBeenCalledWith({ where: { shop }, data: { sftpHostKey: "sha256:new" } });
  });

  it.each([
    ["already pinned", { sftpHostKey: "sha256:old" }, {}, { ok: true, hostKey: "sha256:new" }],
    ["the server changed", {}, { host: "other.example.com" }, { ok: true, hostKey: "sha256:new" }],
    ["the test failed", {}, {}, { ok: false, error: "boom", hostKey: "sha256:new" }],
    ["no key was presented", {}, {}, { ok: true }],
  ])("does not pin when %s", async (_label, configFields, formFields, response) => {
    const shop = newShop();
    sftp.test.mockResolvedValue(response);
    const { result, raw } = run(shop, stored(shop, configFields), { intent: "test", ...formFields });
    await result;
    expect(raw.merchantConfig.update).not.toHaveBeenCalled();
  });

  it("limits connection tests to ten a minute per store", async () => {
    const shop = newShop();
    for (let i = 0; i < 10; i++) await run(shop, null, { intent: "test" }).result;
    expect(await run(shop, null, { intent: "test" }).result).toEqual({
      ok: false,
      message: "Too many connection attempts. Try again in a minute.",
    });
    expect(sftp.test).toHaveBeenCalledTimes(10);
    expect(await run(newShop(), null, { intent: "test" }).result).toMatchObject({ ok: true });
  });
});

describe("submitSettings: save", () => {
  it.each([
    ["an invalid file name", { filenameTemplate: "orders.csv" }, "File name must include {order} or {order_id}"],
    ["an unknown column", { csvColumns: "sku\nnope" }, 'Unknown column "nope"'],
  ])("rejects %s without saving or contacting the server", async (_label, fields, message) => {
    const { result, raw } = run(newShop(), null, fields);
    expect(await result).toEqual({ ok: false, message });
    expect(raw.merchantConfig.upsert).not.toHaveBeenCalled();
    expect(sftp.test).not.toHaveBeenCalled();
  });

  it("saves the settings with the secret encrypted and pins the presented host key", async () => {
    const shop = newShop();
    const { result, raw } = run(shop, null, { csvColumns: "order_name\nsku:Item Code", exportTrigger: "paid", filenameTemplate: "po-{order}.csv" });
    expect(await result).toEqual({ ok: true, message: "Settings saved." });

    const [{ where, create, update }] = raw.merchantConfig.upsert.mock.calls[0];
    expect(where).toEqual({ shop });
    expect(update).toEqual(expect.objectContaining({
      sftpHost: "sftp.example.com", sftpPort: 22, sftpUsername: "u", targetDirectory: "/upload",
      filenameTemplate: "po-{order}.csv", exportTrigger: "paid", csvColumns: "order_name\nsku:Item Code",
      sftpHostKey: "sha256:new", authMethod: "password", sftpPrivateKeyEncrypted: null,
    }));
    expect(create).toEqual({ shop, ...update });
    expect(update.sftpPasswordEncrypted).toBeTruthy();
    expect(JSON.stringify(update)).not.toContain(PASSWORD);
  });

  it("stores the default columns as null and an unknown trigger as created", async () => {
    const { result, raw } = run(newShop(), null, { csvColumns: `${DEFAULT_COLUMN_SPEC.replaceAll("\n", "\r\n")}\r\n`, exportTrigger: "weekly" });
    await result;
    expect(raw.merchantConfig.upsert.mock.calls[0][0].update).toMatchObject({ csvColumns: null, exportTrigger: "created" });
  });

  it("keeps the old pin when the server cannot be reached, for the same server", async () => {
    const shop = newShop();
    sftp.test.mockResolvedValue({ ok: false, error: "down" });
    const { result, raw } = run(shop, stored(shop, { sftpHostKey: "sha256:old" }), { password: "" });
    expect(await result).toEqual({ ok: true, message: "Settings saved." });
    expect(raw.merchantConfig.upsert.mock.calls[0][0].update.sftpHostKey).toBe("sha256:old");
  });

  it("drops the old pin when the server changes and cannot be reached", async () => {
    const shop = newShop();
    sftp.test.mockResolvedValue({ ok: false, error: "down" });
    const { result, raw } = run(shop, stored(shop, { sftpHostKey: "sha256:old" }), { host: "other.example.com" });
    expect((await result).message).toMatch(/host key will be trusted on the first successful connection/);
    expect(raw.merchantConfig.upsert.mock.calls[0][0].update.sftpHostKey).toBeNull();
  });

  it("re-trusts the key the server presents now", async () => {
    const shop = newShop();
    const { result, raw } = run(shop, stored(shop, { sftpHostKey: "sha256:old" }), { password: "" });
    await result;
    expect(raw.merchantConfig.upsert.mock.calls[0][0].update.sftpHostKey).toBe("sha256:new");
  });

  it("still saves, without probing the server, when the store is over the test limit", async () => {
    const shop = newShop();
    for (let i = 0; i < 10; i++) await run(shop, null, { intent: "test" }).result;
    sftp.test.mockClear();
    const { result, raw } = run(shop, null);
    expect((await result).ok).toBe(true);
    expect(sftp.test).not.toHaveBeenCalled();
    expect(raw.merchantConfig.upsert).toHaveBeenCalledTimes(1);
  });
});
