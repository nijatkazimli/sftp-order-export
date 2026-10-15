import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  webhook: vi.fn(),
  findConfig: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  wake: vi.fn(),
}));

vi.mock("../shopify.server", () => ({ authenticate: { webhook: mocks.webhook } }));
vi.mock("../db.server", () => ({
  default: {
    merchantConfig: { findUnique: mocks.findConfig },
    exportJob: { create: mocks.create, deleteMany: mocks.deleteMany },
  },
}));
vi.mock("./exportWorker.server", () => ({ wakeExportWorker: mocks.wake }));

import { handleOrderWebhook } from "./orderWebhook.server";

const request = new Request("https://app.example/webhooks/orders/create", { method: "POST" });
const order = { id: 7, name: "#7", line_items: [] };
const config = { csvColumns: null, filenameTemplate: "order-{order}.csv", exportTrigger: "created" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
  mocks.webhook.mockResolvedValue({ shop: "a.myshopify.com", topic: "ORDERS_CREATE", payload: order });
  mocks.findConfig.mockResolvedValue(config);
  mocks.create.mockResolvedValue({});
  mocks.deleteMany.mockResolvedValue({ count: 0 });
});

describe("handleOrderWebhook", () => {
  it("queues the order and wakes the worker, replying 200", async () => {
    const response = await handleOrderWebhook(request, "created");
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ shop: "a.myshopify.com", orderId: "7", status: "pending" });
    expect(mocks.wake).toHaveBeenCalledTimes(1);
  });

  it("ignores the topic the store did not choose", async () => {
    mocks.findConfig.mockResolvedValue({ ...config, exportTrigger: "paid" });
    expect((await handleOrderWebhook(request, "created")).status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.wake).not.toHaveBeenCalled();

    expect((await handleOrderWebhook(request, "paid")).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a store without settings", async () => {
    mocks.findConfig.mockResolvedValue(null);
    expect((await handleOrderWebhook(request, "created")).status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("does not queue or wake for a duplicate delivery", async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    expect((await handleOrderWebhook(request, "created")).status).toBe(200);
    expect(mocks.wake).not.toHaveBeenCalled();
  });

  it("fails the webhook when the database is down, so Shopify retries", async () => {
    mocks.create.mockRejectedValue(new Error("db down"));
    await expect(handleOrderWebhook(request, "created")).rejects.toThrow("db down");
  });
});
