import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Order contents are only held, encrypted, while a file waits for delivery, so
// customer redaction removes queued files and data requests have nothing to return.
export const action = async ({ request }: ActionFunctionArgs) => {
  // Throws a 401 response when the HMAC is invalid.
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic === "CUSTOMERS_REDACT") {
    const orderIds = (payload.orders_to_redact as number[] | undefined) ?? [];
    await db.exportJob.deleteMany({
      where: { shop, orderId: { in: orderIds.map(String) } },
    });
  }

  if (topic === "SHOP_REDACT") {
    await db.session.deleteMany({ where: { shop } });
    await db.merchantConfig.deleteMany({ where: { shop } });
    await db.exportJob.deleteMany({ where: { shop } });
  }

  return new Response();
};
