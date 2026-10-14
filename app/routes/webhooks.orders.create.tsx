import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { toSftpConfig } from "../services/credentials.server";
import { uploadCsvToSftp } from "../services/sftp.server";
import { orderToCsv, type ShopifyOrderPayload } from "../services/orderCsv.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const order = payload as unknown as ShopifyOrderPayload;

  console.log(`Received ${topic} webhook for ${shop}`);

  const config = await db.merchantConfig.findUnique({ where: { shop } });
  if (!config) return new Response();

  const filename = `order-${order.name ?? order.id}`.replace(/[^\w.-]/g, "_");
  const orderName = order.name ?? String(order.id);
  const record = (status: string, error?: string) =>
    db.exportLog
      .create({ data: { shop, orderName, status, error: error?.slice(0, 500) } })
      .catch((e) => console.error("Failed to write export log", e));

  try {
    await uploadCsvToSftp(
      toSftpConfig(config),
      `${filename}.csv`,
      orderToCsv(order),
    );
    await record("success");
  } catch (error) {
    console.error(`SFTP upload failed for ${shop} order ${order.id}`, error);
    await record(
      "failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    // Non-2xx makes Shopify retry the delivery.
    return new Response(null, { status: 500 });
  }

  return new Response();
};
