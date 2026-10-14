import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { decrypt } from "../utils/crypto.server";
import { uploadCsvToSftp } from "../services/sftp.server";
import { orderToCsv, type ShopifyOrderPayload } from "../services/orderCsv.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const order = payload as unknown as ShopifyOrderPayload;

  console.log(`Received ${topic} webhook for ${shop}`);

  const config = await db.merchantConfig.findUnique({ where: { shop } });
  if (!config) return new Response();

  const filename = `order-${order.name ?? order.id}`.replace(/[^\w.-]/g, "_");

  try {
    await uploadCsvToSftp(
      {
        host: config.sftpHost,
        port: config.sftpPort,
        username: config.sftpUsername,
        password: decrypt({
          encrypted: config.sftpPasswordEncrypted,
          iv: config.sftpIv,
        }),
        targetDirectory: config.targetDirectory,
      },
      `${filename}.csv`,
      orderToCsv(order),
    );
  } catch (error) {
    console.error(`SFTP upload failed for ${shop} order ${order.id}`, error);
    // Non-2xx makes Shopify retry the delivery.
    return new Response(null, { status: 500 });
  }

  return new Response();
};
