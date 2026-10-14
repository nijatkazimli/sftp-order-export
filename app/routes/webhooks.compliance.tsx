import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Order data goes straight to the merchant's SFTP and is never stored here,
// so customer data requests/redactions have nothing to act on.
export const action = async ({ request }: ActionFunctionArgs) => {
  // Throws a 401 response when the HMAC is invalid.
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    await db.session.deleteMany({ where: { shop } });
    await db.merchantConfig.deleteMany({ where: { shop } });
    await db.exportLog.deleteMany({ where: { shop } });
  }

  return new Response();
};
