import type { MerchantConfig } from "@prisma/client";
import type { SftpConfig } from "./sftp.server";
import { decrypt, encrypt } from "../utils/crypto.server";

export type AuthMethod = "password" | "privateKey";

interface KeyCredential {
  privateKey: string;
  passphrase?: string;
}

export type Credential =
  | { method: "password"; password: string }
  | ({ method: "privateKey" } & KeyCredential);

/** Columns to write for a credential; the unused method's columns are cleared. */
export function encryptCredential(credential: Credential) {
  if (credential.method === "password") {
    const { encrypted, iv } = encrypt(credential.password);
    return {
      authMethod: "password",
      sftpPasswordEncrypted: encrypted,
      sftpIv: iv,
      sftpPrivateKeyEncrypted: null,
      sftpKeyIv: null,
    };
  }
  const { encrypted, iv } = encrypt(
    JSON.stringify({
      privateKey: credential.privateKey,
      passphrase: credential.passphrase,
    }),
  );
  return {
    authMethod: "privateKey",
    sftpPasswordEncrypted: null,
    sftpIv: null,
    sftpPrivateKeyEncrypted: encrypted,
    sftpKeyIv: iv,
  };
}

/** Returns the stored credential, or undefined if its columns are empty. */
export function decryptCredential(row: MerchantConfig): Credential | undefined {
  if (row.authMethod === "privateKey") {
    if (!row.sftpPrivateKeyEncrypted || !row.sftpKeyIv) return undefined;
    const key = JSON.parse(
      decrypt({ encrypted: row.sftpPrivateKeyEncrypted, iv: row.sftpKeyIv }),
    ) as KeyCredential;
    return { method: "privateKey", ...key };
  }
  if (!row.sftpPasswordEncrypted || !row.sftpIv) return undefined;
  return {
    method: "password",
    password: decrypt({ encrypted: row.sftpPasswordEncrypted, iv: row.sftpIv }),
  };
}

export function credentialToAuth(
  credential: Credential,
): Pick<SftpConfig, "password" | "privateKey" | "passphrase"> {
  return credential.method === "password"
    ? { password: credential.password }
    : { privateKey: credential.privateKey, passphrase: credential.passphrase };
}

export function toSftpConfig(row: MerchantConfig): SftpConfig {
  const credential = decryptCredential(row);
  if (!credential) throw new Error("Stored SFTP credential is missing");
  return {
    host: row.sftpHost,
    port: row.sftpPort,
    username: row.sftpUsername,
    targetDirectory: row.targetDirectory,
    ...credentialToAuth(credential),
  };
}
