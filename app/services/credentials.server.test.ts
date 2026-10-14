import type { MerchantConfig } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  toSftpConfig,
} from "./credentials.server";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32)));
afterEach(() => vi.unstubAllEnvs());

const row = (columns: ReturnType<typeof encryptCredential>) =>
  ({
    sftpHost: "h",
    sftpPort: 22,
    sftpUsername: "u",
    targetDirectory: "/upload",
    ...columns,
  }) as MerchantConfig;

describe("credentials", () => {
  it("round-trips a password and clears key columns", () => {
    const password = randomUUID();
    const columns = encryptCredential({ method: "password", password });
    expect(columns.sftpPrivateKeyEncrypted).toBeNull();
    expect(decryptCredential(row(columns))).toEqual({
      method: "password",
      password,
    });
  });

  it("round-trips a private key with passphrase and clears password columns", () => {
    const columns = encryptCredential({
      method: "privateKey",
      privateKey: "KEY",
      passphrase: "pp",
    });
    expect(columns.sftpPasswordEncrypted).toBeNull();
    expect(columns.sftpPrivateKeyEncrypted).not.toContain("KEY");
    expect(decryptCredential(row(columns))).toEqual({
      method: "privateKey",
      privateKey: "KEY",
      passphrase: "pp",
    });
  });

  it("builds an SFTP config with only the relevant secret", () => {
    const config = toSftpConfig(
      row(encryptCredential({ method: "privateKey", privateKey: "KEY" })),
    );
    expect(config.privateKey).toBe("KEY");
    expect(config.password).toBeUndefined();
  });

  it("returns undefined when the credential columns are empty", () => {
    const empty = row(
      encryptCredential({ method: "password", password: randomUUID() }),
    );
    empty.sftpPasswordEncrypted = null;
    expect(decryptCredential(empty)).toBeUndefined();
    expect(() => toSftpConfig(empty)).toThrow(/missing/);
  });
});
