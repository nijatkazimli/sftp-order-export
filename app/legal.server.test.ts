import { describe, expect, it, vi } from "vitest";
import { legalConfig, LEGAL_LAST_UPDATED } from "./legal.server";
import { EXPORT_HISTORY_RETENTION_DAYS, RETRY_WINDOW_MS } from "./services/exportQueue.constants";

describe("legalConfig", () => {
  it("reads operator details from the environment", () => {
    const config = legalConfig({
      LEGAL_ENTITY_NAME: "Example Ltd",
      SUPPORT_EMAIL: "help@example.com",
      HOSTING_REGION: "Frankfurt, Germany",
      GOVERNING_LAW: "the laws of Germany",
    } as NodeJS.ProcessEnv);
    expect(config).toMatchObject({
      entity: "Example Ltd",
      email: "help@example.com",
      region: "Frankfurt, Germany",
      law: "the laws of Germany",
      updated: LEGAL_LAST_UPDATED,
    });
  });

  it("ties the stated retention periods to the code that enforces them", () => {
    const config = legalConfig({} as NodeJS.ProcessEnv);
    expect(config.retentionDays).toBe(EXPORT_HISTORY_RETENTION_DAYS);
    expect(config.retryDays).toBe(2);
    expect(RETRY_WINDOW_MS).toBeLessThanOrEqual(config.retryDays * 24 * 60 * 60 * 1000);
  });

  it("shows visible placeholders and warns in production when settings are missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = legalConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(config.entity).toBe("[legal entity name]");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("entity, email, region, law"));
    warn.mockRestore();
  });

  it("stays quiet outside production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    legalConfig({} as NodeJS.ProcessEnv);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
