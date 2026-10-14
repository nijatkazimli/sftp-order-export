import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "./crypto.server";

const KEY_A = "ab".repeat(32);
const KEY_B = "cd".repeat(32);
const SHOP = "a.myshopify.com";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", KEY_A));
afterEach(() => vi.unstubAllEnvs());

describe("crypto", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("p@ss wörd", SHOP), SHOP)).toBe("p@ss wörd");
  });

  it("uses a fresh IV and ciphertext each time", () => {
    const a = encrypt("same", SHOP);
    const b = encrypt("same", SHOP);
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("does not store the plaintext", () => {
    const { encrypted } = encrypt("hunter2", SHOP);
    expect(Buffer.from(encrypted, "base64").toString("utf8")).not.toContain(
      "hunter2",
    );
  });

  it("rejects tampered ciphertext", () => {
    const value = encrypt("secret", SHOP);
    const data = Buffer.from(value.encrypted, "base64");
    data[0] ^= 1;
    expect(() =>
      decrypt({ ...value, encrypted: data.toString("base64") }, SHOP),
    ).toThrow();
  });

  it("rejects ciphertext shorter than the auth tag", () => {
    expect(() => decrypt({ encrypted: "AAAA", iv: "AAAA" }, SHOP)).toThrow(
      /too short/,
    );
  });

  it("rejects ciphertext moved to another owner", () => {
    const value = encrypt("secret", SHOP);
    expect(() => decrypt(value, "b.myshopify.com")).toThrow();
  });

  it("rejects decryption with a different key", () => {
    const value = encrypt("secret", SHOP);
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    expect(() => decrypt(value, SHOP)).toThrow();
  });

  it("decrypts old data after rotation via ENCRYPTION_KEY_PREVIOUS", () => {
    const value = encrypt("secret", SHOP);
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    vi.stubEnv("ENCRYPTION_KEY_PREVIOUS", KEY_A);
    expect(decrypt(value, SHOP)).toBe("secret");
    // New writes use the new key only.
    const fresh = encrypt("again", SHOP);
    vi.stubEnv("ENCRYPTION_KEY_PREVIOUS", "");
    expect(decrypt(fresh, SHOP)).toBe("again");
  });

  it.each(["", "abcd", "zz".repeat(32)])("rejects invalid key %j", (key) => {
    vi.stubEnv("ENCRYPTION_KEY", key);
    expect(() => encrypt("x", SHOP)).toThrow(/ENCRYPTION_KEY/);
  });
});
