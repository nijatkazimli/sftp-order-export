import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import type { AuthMethod } from "../services/credentials.server";
import type { ExportTrigger } from "../services/exportQueue.constants";
import {
  loadSettingsView,
  submitSettings,
  type SampleFile,
} from "../services/settings.server";

function exportStatus(status: string, attempts: number): [tone: "success" | "warning" | "critical", label: string] {
  if (status === "success") return ["success", "Exported"];
  if (status === "pending") return ["warning", attempts ? "Retrying" : "Queued"];
  return ["critical", "Failed"];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return loadSettingsView(db, session.shop);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return submitSettings(db, session.shop, await request.formData());
};

export default function Index() {
  const saved = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [host, setHost] = useState(saved.host);
  const [port, setPort] = useState(String(saved.port));
  const [username, setUsername] = useState(saved.username);
  const [authMethod, setAuthMethod] = useState<AuthMethod>(saved.authMethod);
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [targetDirectory, setTargetDirectory] = useState(saved.targetDirectory);
  const [filenameTemplate, setFilenameTemplate] = useState(
    saved.filenameTemplate,
  );
  const [csvColumns, setCsvColumns] = useState(saved.csvColumns);
  const [exportTrigger, setExportTrigger] = useState<ExportTrigger>(
    saved.exportTrigger,
  );
  const [confirmTest, setConfirmTest] = useState(false);
  const [preview, setPreview] = useState<SampleFile | null>(null);

  const busy = fetcher.state !== "idle";
  const submittedIntent = fetcher.formData?.get("intent");
  const errors = fetcher.data?.errors ?? {};
  const tokenHint = saved.filenameTokens.map((t) => `{${t}}`).join(", ");
  const buttonState = (intent: string) => ({
    ...(busy && submittedIntent === intent ? { loading: true } : {}),
    ...(busy ? { disabled: true } : {}),
  });
  const keepHint = (method: AuthMethod) =>
    saved.hasCredential && saved.authMethod === method
      ? "Leave blank to keep the saved value"
      : "";

  useEffect(() => {
    if (fetcher.data?.preview) setPreview(fetcher.data.preview);
    else if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  const submit = (intent: "test" | "save" | "preview" | "send-test") =>
    fetcher.submit(
      {
        intent,
        host,
        port,
        username,
        authMethod,
        password,
        privateKey,
        passphrase,
        targetDirectory,
        filenameTemplate,
        exportTrigger,
        csvColumns,
        confirmTest: confirmTest ? "1" : "",
      },
      { method: "POST" },
    );

  return (
    <s-page heading="SFTP order export">
      <s-section heading="SFTP settings">
        <s-stack direction="block" gap="base">
          {fetcher.data && !fetcher.data.ok && (
            <s-banner tone="critical">{fetcher.data.message}</s-banner>
          )}
          {fetcher.data?.ok && !fetcher.data.preview && (
            <s-banner tone="success">{fetcher.data.message}</s-banner>
          )}
          <s-text-field
            label="Host"
            value={host}
            error={errors.host}
            onInput={(e) => setHost(e.currentTarget.value)}
          />
          <s-text-field
            label="Port"
            value={port}
            error={errors.port}
            onInput={(e) => setPort(e.currentTarget.value)}
          />
          <s-text-field
            label="Username"
            value={username}
            error={errors.username}
            onInput={(e) => setUsername(e.currentTarget.value)}
          />
          <s-select
            label="Authentication"
            value={authMethod}
            onChange={(e) => setAuthMethod(e.currentTarget.value as AuthMethod)}
          >
            <s-option value="password">Password</s-option>
            <s-option value="privateKey">Private key</s-option>
          </s-select>
          {authMethod === "password" ? (
            <s-password-field
              label="Password"
              value={password}
              error={errors.password}
              details={keepHint("password")}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          ) : (
            <>
              <s-text-area
                label="Private key"
                rows={6}
                value={privateKey}
                error={errors.privateKey}
                details={keepHint("privateKey")}
                onInput={(e) => setPrivateKey(e.currentTarget.value)}
              />
              <s-password-field
                label="Key passphrase (optional)"
                value={passphrase}
                onInput={(e) => setPassphrase(e.currentTarget.value)}
              />
            </>
          )}
          <s-text-field
            label="Target path"
            value={targetDirectory}
            error={errors.targetDirectory}
            onInput={(e) => setTargetDirectory(e.currentTarget.value)}
          />
          <s-select
            label="Export orders"
            value={exportTrigger}
            details="Cash-on-delivery and bank-transfer orders are not paid when they are created. Choose “paid” to export an order only once payment is received."
            onChange={(e) => setExportTrigger(e.currentTarget.value as ExportTrigger)}
          >
            <s-option value="created">When an order is created</s-option>
            <s-option value="paid">When an order is paid</s-option>
          </s-select>
          <s-text-field
            label="File name"
            value={filenameTemplate}
            error={errors.filenameTemplate}
            details={`Placeholders: ${tokenHint}. Must include {order} or {order_id}.`}
            onInput={(e) => setFilenameTemplate(e.currentTarget.value)}
          />
          <s-text-area
            label="CSV columns"
            rows={8}
            value={csvColumns}
            error={errors.csvColumns}
            details={`One column per line, in order. Add :Header to rename, e.g. sku:Item Code. Available: ${saved.availableColumns.join(", ")}.`}
            onInput={(e) => setCsvColumns(e.currentTarget.value)}
          />
          <s-paragraph>
            {saved.hostKey
              ? `Trusted server key: ${saved.hostKey}`
              : "The server's host key will be trusted on the first successful connection."}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => submit("test")} {...buttonState("test")}>
              Test connection
            </s-button>
            <s-button
              variant="primary"
              onClick={() => submit("save")}
              {...buttonState("save")}
            >
              Save settings
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Sample file">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            See what a file will look like with the file name and columns above,
            using a made-up order. You can also upload it to your server to check
            the whole path works.
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => submit("preview")} {...buttonState("preview")}>
              Preview file
            </s-button>
          </s-stack>
          {preview && (
            <s-stack direction="block" gap="base">
              <s-text>File name: {preview.filename}</s-text>
              <s-box
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <pre style={{ margin: 0, overflowX: "auto" }}>
                  <code>{preview.csv}</code>
                </pre>
              </s-box>
            </s-stack>
          )}
          <s-checkbox
            label="My supplier may process the test file as a real order"
            details="The test file is uploaded to your server like a real export, for an order named #TEST."
            checked={confirmTest}
            onChange={(e) => setConfirmTest(e.currentTarget.checked)}
          />
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={() => submit("send-test")}
              {...buttonState("send-test")}
              {...(confirmTest ? {} : { disabled: true })}
            >
              Send test file
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Recent exports">
        {saved.exports.length === 0 ? (
          <s-paragraph>No orders exported yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Order</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Time</s-table-header>
              <s-table-header>Details</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {saved.exports.map((e) => {
                const [tone, label] = exportStatus(e.status, e.attempts);
                return (
                  <s-table-row key={e.id}>
                    <s-table-cell>{e.orderName}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={tone}>{label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      {e.createdAt.slice(0, 16).replace("T", " ")} UTC
                    </s-table-cell>
                    <s-table-cell>{e.error ?? ""}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Legal">
        <s-stack direction="block" gap="base">
          <s-link href="/privacy" target="_blank">
            Privacy policy
          </s-link>
          <s-link href="/terms" target="_blank">
            Terms of service
          </s-link>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
