import {
  EXPORT_HISTORY_RETENTION_DAYS,
  RETRY_WINDOW_DAYS,
} from "./services/exportQueue.constants";

/** Update when the policy or terms change. */
export const LEGAL_LAST_UPDATED = "15 October 2026";

const PLACEHOLDERS = {
  entity: "[legal entity name]",
  email: "[support email]",
  region: "[hosting region]",
  law: "[governing law and venue]",
};

/** Operator details come from the environment, so no personal data lives in the repo. */
export function legalConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = {
    entity: env.LEGAL_ENTITY_NAME || PLACEHOLDERS.entity,
    email: env.SUPPORT_EMAIL || PLACEHOLDERS.email,
    region: env.HOSTING_REGION || PLACEHOLDERS.region,
    law: env.GOVERNING_LAW || PLACEHOLDERS.law,
    updated: LEGAL_LAST_UPDATED,
    retentionDays: EXPORT_HISTORY_RETENTION_DAYS,
    retryDays: RETRY_WINDOW_DAYS,
  };
  const missing = Object.entries(PLACEHOLDERS)
    .filter(([key, value]) => config[key as keyof typeof PLACEHOLDERS] === value)
    .map(([key]) => key);
  if (missing.length && env.NODE_ENV === "production") {
    console.warn(
      `Legal pages are missing settings: ${missing.join(", ")} (LEGAL_ENTITY_NAME, SUPPORT_EMAIL, HOSTING_REGION, GOVERNING_LAW)`,
    );
  }
  return config;
}
