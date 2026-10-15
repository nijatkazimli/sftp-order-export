import db from "../db.server";
import { processDueJobs } from "./exportQueue.server";
import { pruneExportJobs } from "./retention.server";

const POLL_INTERVAL_MS = 15_000;

let started = false;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await pruneExportJobs(db);
    await processDueJobs(db);
  } catch (error) {
    console.error("Export worker error", error);
  } finally {
    running = false;
  }
}

/** Starts the polling loop once per process; safe to call from anywhere. */
export function startExportWorker() {
  if (started) return;
  started = true;
  setInterval(() => void tick(), POLL_INTERVAL_MS).unref();
  void tick();
}

/** Processes new jobs right away instead of waiting for the next poll. */
export function wakeExportWorker() {
  startExportWorker();
  setImmediate(() => void tick());
}
