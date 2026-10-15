import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const TAG_LENGTH = 16;

function parseKey(hex: string | undefined, name: string): Buffer {
  const key = Buffer.from(hex ?? "", "hex");
  if (key.length !== 32) {
    throw new Error(`${name} must be 32 bytes encoded as 64 hex chars`);
  }
  return key;
}

/** The current key first, then the previous one so ENCRYPTION_KEY can be rotated without data loss. */
function getKeys(): Buffer[] {
  const keys = [parseKey(process.env.ENCRYPTION_KEY, "ENCRYPTION_KEY")];
  if (process.env.ENCRYPTION_KEY_PREVIOUS) {
    keys.push(
      parseKey(process.env.ENCRYPTION_KEY_PREVIOUS, "ENCRYPTION_KEY_PREVIOUS"),
    );
  }
  return keys;
}

export interface EncryptedValue {
  /** base64(ciphertext || authTag) */
  encrypted: string;
  /** base64 IV */
  iv: string;
}

/** `aad` binds the ciphertext to its owner (e.g. the shop), so it can't be moved to another row. */
export function encrypt(plaintext: string, aad: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKeys()[0], iv, {
    authTagLength: TAG_LENGTH,
  });
  cipher.setAAD(Buffer.from(aad, "utf8"));
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

/** True if the value is readable with ENCRYPTION_KEY alone, i.e. it needs no rotation. */
export function isCurrentKey(value: EncryptedValue, aad: string): boolean {
  try {
    decryptWith(getKeys().slice(0, 1), value, aad);
    return true;
  } catch {
    return false;
  }
}

export function decrypt(value: EncryptedValue, aad: string): string {
  return decryptWith(getKeys(), value, aad);
}

function decryptWith(
  keys: Buffer[],
  { encrypted, iv }: EncryptedValue,
  aad: string,
): string {
  const data = Buffer.from(encrypted, "base64");
  if (data.length < TAG_LENGTH) throw new Error("Ciphertext is too short");
  const body = data.subarray(0, data.length - TAG_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);

  let lastError: unknown;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(iv, "base64"),
        { authTagLength: TAG_LENGTH },
      );
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString(
        "utf8",
      );
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
