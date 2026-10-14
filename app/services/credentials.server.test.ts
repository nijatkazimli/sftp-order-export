import type { MerchantConfig } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  sameEndpoint,
  toSftpConfig,
} from "./credentials.server";

const SHOP = "a.myshopify.com";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32)));
afterEach(() => vi.unstubAllEnvs());

const row = (columns: ReturnType<typeof encryptCredential>, shop = SHOP) =>
  ({
    shop,
    sftpHost: "h",
    sftpPort: 22,
    sftpUsername: "u",
    targetDirectory: "/upload",
    ...columns,
  }) as MerchantConfig;

describe("credentials", () => {
  it("round-trips a password and clears key columns", () => {
    const password = randomUUID();
    const columns = encryptCredential({ method: "password", password }, SHOP);
    expect(columns.sftpPrivateKeyEncrypted).toBeNull();
    expect(decryptCredential(row(columns))).toEqual({
      method: "password",
      password,
    });
  });

  it("round-trips a private key with passphrase and clears password columns", () => {
    const columns = encryptCredential(
      { method: "privateKey", privateKey: "KEY", passphrase: "pp" },
      SHOP,
    );
    expect(columns.sftpPasswordEncrypted).toBeNull();
    expect(columns.sftpPrivateKeyEncrypted).not.toContain("KEY");
    expect(decryptCredential(row(columns))).toEqual({
      method: "privateKey",
      privateKey: "KEY",
      passphrase: "pp",
    });
  });

  it("refuses a credential copied into another shop's row", () => {
    const columns = encryptCredential(
      { method: "password", password: randomUUID() },
      SHOP,
    );
    expect(() => decryptCredential(row(columns, "b.myshopify.com"))).toThrow();
  });

  it("builds an SFTP config with only the relevant secret", () => {
    const config = toSftpConfig(
      row(
        encryptCredential({ method: "privateKey", privateKey: "KEY" }, SHOP),
      ),
    );
    expect(config.privateKey).toBe("KEY");
    expect(config.password).toBeUndefined();
  });

  it("returns undefined when the credential columns are empty", () => {
    const empty = row(
      encryptCredential({ method: "password", password: randomUUID() }, SHOP),
    );
    empty.sftpPasswordEncrypted = null;
    expect(decryptCredential(empty)).toBeUndefined();
    expect(() => toSftpConfig(empty)).toThrow(/missing/);
  });

  it("passes the pinned host key into the SFTP config", () => {
    const base = row(
      encryptCredential({ method: "password", password: randomUUID() }, SHOP),
    );
    expect(toSftpConfig(base).expectedHostKey).toBeUndefined();
    expect(
      toSftpConfig({ ...base, sftpHostKey: "sha256:abc" }).expectedHostKey,
    ).toBe("sha256:abc");
  });
});

describe("sameEndpoint", () => {
  const saved = { sftpHost: "h", sftpPort: 22, sftpUsername: "u" };

  it("matches only when host, port and username are all unchanged", () => {
    expect(sameEndpoint(saved, { host: "h", port: 22, username: "u" })).toBe(true);
    expect(sameEndpoint(saved, { host: "evil", port: 22, username: "u" })).toBe(false);
    expect(sameEndpoint(saved, { host: "h", port: 2222, username: "u" })).toBe(false);
    expect(sameEndpoint(saved, { host: "h", port: 22, username: "root" })).toBe(false);
  });
});
