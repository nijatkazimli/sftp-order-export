import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be 32 bytes encoded as 64 hex chars");
  }
  return key;
}

export interface EncryptedValue {
  /** base64(ciphertext || authTag) */
  encrypted: string;
  /** base64 IV */
  iv: string;
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString(
      "base64",
    ),
    iv: iv.toString("base64"),
  };
}

export function decrypt({ encrypted, iv }: EncryptedValue): string {
  const data = Buffer.from(encrypted, "base64");
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(data.subarray(data.length - TAG_LENGTH));
  return Buffer.concat([
    decipher.update(data.subarray(0, data.length - TAG_LENGTH)),
    decipher.final(),
  ]).toString("utf8");
}
