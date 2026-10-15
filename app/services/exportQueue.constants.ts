export type ExportTrigger = "created" | "paid";
export const EXPORT_TRIGGERS: ExportTrigger[] = ["created", "paid"];

const MINUTE = 60_000;

/** Wait before each retry; after the last one the export is marked failed. */
export const RETRY_DELAYS_MS = [1, 5, 15, 60, 180, 360, 720, 1440].map(
  (minutes) => minutes * MINUTE,
);
export const RETRY_WINDOW_MS = RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);

export const EXPORT_HISTORY_RETENTION_DAYS = 90;

/** Whole days a failing export may be retried; shown in the privacy policy. */
export const RETRY_WINDOW_DAYS = Math.ceil(RETRY_WINDOW_MS / (24 * 60 * 60 * 1000));
