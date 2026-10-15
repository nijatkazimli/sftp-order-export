import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webhook: vi.fn(),
  jobs: vi.fn(),
  sessions: vi.fn(),
  configs: vi.fn(),
}));

vi.mock("../shopify.server", () => ({ authenticate: { webhook: mocks.webhook } }));
vi.mock("../db.server", () => ({
  default: {
    exportJob: { deleteMany: mocks.jobs },
    session: { deleteMany: mocks.sessions },
    merchantConfig: { deleteMany: mocks.configs },
  },
}));

import { action } from "../routes/webhooks.compliance";

const call = (topic: string, payload: Record<string, unknown> = {}) => {
  mocks.webhook.mockResolvedValue({ shop: "a.myshopify.com", topic, payload });
  return action({ request: new Request("https://app.example/webhooks/compliance", { method: "POST" }) } as never);
};

beforeEach(() => vi.resetAllMocks());

describe("compliance webhooks", () => {
  it("removes queued files for redacted customers' orders only", async () => {
    await call("CUSTOMERS_REDACT", { orders_to_redact: [11, 12] });
    expect(mocks.jobs).toHaveBeenCalledWith({
      where: { shop: "a.myshopify.com", orderId: { in: ["11", "12"] } },
    });
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.configs).not.toHaveBeenCalled();
  });

  it("handles a redaction request without orders", async () => {
    await call("CUSTOMERS_REDACT", {});
    expect(mocks.jobs).toHaveBeenCalledWith({ where: { shop: "a.myshopify.com", orderId: { in: [] } } });
  });

  it("deletes everything for a store on shop redact", async () => {
    await call("SHOP_REDACT");
    expect(mocks.jobs).toHaveBeenCalledWith({ where: { shop: "a.myshopify.com" } });
    expect(mocks.sessions).toHaveBeenCalledWith({ where: { shop: "a.myshopify.com" } });
    expect(mocks.configs).toHaveBeenCalledWith({ where: { shop: "a.myshopify.com" } });
  });

  it("only acknowledges customer data requests", async () => {
    const response = await call("CUSTOMERS_DATA_REQUEST", { customer: { id: 1 } });
    expect(response.status).toBe(200);
    expect(mocks.jobs).not.toHaveBeenCalled();
  });
});
