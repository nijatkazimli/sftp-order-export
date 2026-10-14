import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { toSftpConfig } from "../services/credentials.server";
import { uploadCsvToSftp } from "../services/sftp.server";
import {
  orderToCsv,
  parseColumnSpec,
  renderFilename,
  type ShopifyOrderPayload,
} from "../services/orderCsv.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const order = payload as unknown as ShopifyOrderPayload;

  console.log(`Received ${topic} webhook for ${shop}`);

  const config = await db.merchantConfig.findUnique({ where: { shop } });
  if (!config) return new Response();

  const orderName = order.name ?? String(order.id);
  const record = (status: string, error?: string) =>
    db.exportLog
      .create({ data: { shop, orderName, status, error: error?.slice(0, 500) } })
      .catch((e) => console.error("Failed to write export log", e));

  try {
    const parsed = parseColumnSpec(config.csvColumns);
    if ("error" in parsed) throw new Error(parsed.error);
    const hostKey = await uploadCsvToSftp(
      toSftpConfig(config),
      renderFilename(config.filenameTemplate, order),
      orderToCsv(order, parsed.columns),
    );
    // Trust on first use: remember the key so a changed one is refused later.
    if (!config.sftpHostKey && hostKey) {
      await db.merchantConfig
        .update({ where: { shop }, data: { sftpHostKey: hostKey } })
        .catch((e) => console.error("Failed to store host key", e));
    }
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
