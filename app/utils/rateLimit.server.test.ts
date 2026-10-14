import { describe, expect, it } from "vitest";
import { allow } from "./rateLimit.server";

describe("allow", () => {
  it("blocks after the limit within the window", () => {
    const key = "limit-test";
    for (let i = 0; i < 3; i++) expect(allow(key, 3, 1000, 0)).toBe(true);
    expect(allow(key, 3, 1000, 500)).toBe(false);
  });

  it("allows again once the window has passed", () => {
    const key = "window-test";
    for (let i = 0; i < 2; i++) allow(key, 2, 1000, 0);
    expect(allow(key, 2, 1000, 999)).toBe(false);
    expect(allow(key, 2, 1000, 1001)).toBe(true);
  });

  it("tracks keys independently", () => {
    allow("a-key", 1, 1000, 0);
    expect(allow("b-key", 1, 1000, 0)).toBe(true);
  });
});
