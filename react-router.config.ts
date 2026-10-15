import type { Config } from "@react-router/dev/config";

// TLS ends at the tunnel or proxy, so the server sees http while the browser's Origin is https;
// without this React Router rejects every form POST from the app's own page as cross-origin.
// Read at build time in production (Render passes env vars to the Docker build as build args).
const appUrl = process.env.SHOPIFY_APP_URL;

if (!appUrl && process.env.NODE_ENV === "production") {
  console.warn("SHOPIFY_APP_URL is not set: form submissions will be rejected as cross-origin.");
}

export default {
  allowedActionOrigins: appUrl ? [new URL(appUrl).host] : [],
} satisfies Config;
