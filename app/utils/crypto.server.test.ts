import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "./crypto.server";

beforeEach(() => vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32)));
afterEach(() => vi.unstubAllEnvs());

describe("crypto", () => {
  it("round-trips", () => {
    expect(decrypt(encrypt("p@ss wörd"))).toBe("p@ss wörd");
  });

  it("uses a fresh IV and ciphertext each time", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.encrypted).not.toBe(b.encrypted);
  });

  it("does not store the plaintext", () => {
    const { encrypted } = encrypt("hunter2");
    expect(Buffer.from(encrypted, "base64").toString("utf8")).not.toContain(
      "hunter2",
    );
  });

  it("rejects tampered ciphertext", () => {
    const value = encrypt("secret");
    const data = Buffer.from(value.encrypted, "base64");
    data[0] ^= 1;
    expect(() =>
      decrypt({ ...value, encrypted: data.toString("base64") }),
    ).toThrow();
  });

  it("rejects decryption with a different key", () => {
    const value = encrypt("secret");
    vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32));
    expect(() => decrypt(value)).toThrow();
  });

  it.each(["", "abcd", "zz".repeat(32)])("rejects invalid key %j", (key) => {
    vi.stubEnv("ENCRYPTION_KEY", key);
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY/);
  });
});
