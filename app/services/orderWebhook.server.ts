import db from "../db.server";
import { authenticate } from "../shopify.server";
import { enqueueExport } from "./exportQueue.server";
import type { ExportTrigger } from "./exportQueue.constants";
import { wakeExportWorker } from "./exportWorker.server";
import type { ShopifyOrderPayload } from "./orderCsv.server";
import { pruneExportJobs } from "./retention.server";

/** Records the order for delivery and replies at once; the worker does the SFTP upload. */
export async function handleOrderWebhook(request: Request, trigger: ExportTrigger) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  pruneExportJobs(db).catch((e) => console.error("Failed to prune export jobs", e));

  const config = await db.merchantConfig.findUnique({ where: { shop } });
  // Each store exports on one trigger; the other topic is ignored.
  if (config?.exportTrigger !== trigger) return new Response();

  const order = payload as unknown as ShopifyOrderPayload;
  const result = await enqueueExport(db, { shop, order, config });
  if (result === "queued") wakeExportWorker();
  return new Response();
}
