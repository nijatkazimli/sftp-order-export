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
import {
  credentialToAuth,
  decryptCredential,
  encryptCredential,
  sameEndpoint,
  type AuthMethod,
  type Credential,
} from "../services/credentials.server";
import {
  COLUMN_KEYS,
  DEFAULT_COLUMN_SPEC,
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TOKENS,
  parseColumnSpec,
  validateFilenameTemplate,
} from "../services/orderCsv.server";
import { testSftpConnection } from "../services/sftp.server";
import { allow } from "../utils/rateLimit.server";

const MAX_KEY_LENGTH = 16_384;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await db.merchantConfig.findUnique({
    where: { shop: session.shop },
  });
  const exports = await db.exportLog.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Secrets are never sent back to the browser.
  return {
    exports: exports.map((e) => ({
      id: e.id,
      orderName: e.orderName,
      status: e.status,
      error: e.error,
      createdAt: e.createdAt.toISOString(),
    })),
    host: config?.sftpHost ?? "",
    port: config?.sftpPort ?? 22,
    username: config?.sftpUsername ?? "",
    targetDirectory: config?.targetDirectory ?? "/upload",
    filenameTemplate: config?.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE,
    csvColumns: config?.csvColumns ?? DEFAULT_COLUMN_SPEC,
    availableColumns: COLUMN_KEYS,
    filenameTokens: FILENAME_TOKENS,
    authMethod: (config?.authMethod ?? "password") as AuthMethod,
    hasCredential: Boolean(config),
    hostKey: config?.sftpHostKey ?? null,
  };
};

type ActionResult = { ok: boolean; message: string };

export const action = async ({
  request,
}: ActionFunctionArgs): Promise<ActionResult> => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  const intent = field("intent");
  const host = field("host").trim();
  const port = Number(field("port"));
  const username = field("username").trim();
  const authMethod: AuthMethod =
    field("authMethod") === "privateKey" ? "privateKey" : "password";
  const password = field("password");
  const privateKey = field("privateKey").trim();
  const passphrase = field("passphrase");
  const targetDirectory = field("targetDirectory").trim();
  const filenameTemplate =
    field("filenameTemplate").trim() || DEFAULT_FILENAME_TEMPLATE;
  const csvColumns = field("csvColumns").replaceAll("\r\n", "\n").trim();

  if (!host || !username || !targetDirectory) {
    return { ok: false, message: "Host, username and target path are required." };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: "Port must be between 1 and 65535." };
  }

  const existing = await db.merchantConfig.findUnique({
    where: { shop: session.shop },
  });
  // A stored secret is only reused for the endpoint it was saved for, so it
  // can't be redirected to another server by editing the host.
  const endpointUnchanged = existing
    ? sameEndpoint(existing, { host, port, username })
    : false;
  const pinnedHostKey = endpointUnchanged
    ? (existing?.sftpHostKey ?? undefined)
    : undefined;
  const secretMissing = (what: string) =>
    existing && !endpointUnchanged
      ? `Enter the ${what} again when the host, port or username changes.`
      : `The ${what} is required.`;

  // Blank secret fields keep the stored credential of the same method.
  let stored: Credential | undefined;
  try {
    stored =
      existing && endpointUnchanged ? decryptCredential(existing) : undefined;
  } catch {
    // Unreadable (e.g. key changed): the secret has to be entered again.
  }
  let credential: Credential | undefined;
  if (authMethod === "password") {
    credential = password
      ? { method: "password", password }
      : stored?.method === "password"
        ? stored
        : undefined;
    if (!credential) return { ok: false, message: secretMissing("password") };
  } else if (privateKey) {
    if (privateKey.length > MAX_KEY_LENGTH || !privateKey.includes("PRIVATE KEY")) {
      return { ok: false, message: "Paste a valid private key (PEM format)." };
    }
    credential = {
      method: "privateKey",
      privateKey: `${privateKey}\n`,
      passphrase: passphrase || undefined,
    };
  } else {
    credential = stored?.method === "privateKey" ? stored : undefined;
    if (!credential) return { ok: false, message: secretMissing("private key") };
  }

  if (intent === "test") {
    if (!allow(`sftp-test:${session.shop}`)) {
      return {
        ok: false,
        message: "Too many connection attempts. Try again in a minute.",
      };
    }
    const result = await testSftpConnection({
      host,
      port,
      username,
      targetDirectory,
      expectedHostKey: pinnedHostKey,
      ...credentialToAuth(credential),
    });
    if (result.ok && existing && endpointUnchanged && !existing.sftpHostKey && result.hostKey) {
      await db.merchantConfig.update({
        where: { shop: session.shop },
        data: { sftpHostKey: result.hostKey },
      });
    }
    return result.ok
      ? { ok: true, message: "Connection successful." }
      : { ok: false, message: `Connection failed: ${result.error}` };
  }

  if (intent === "save") {
    const parsedColumns = parseColumnSpec(csvColumns);
    const formatError =
      validateFilenameTemplate(filenameTemplate) ??
      ("error" in parsedColumns ? parsedColumns.error : null);
    if (formatError) return { ok: false, message: formatError };

    // Saving trusts the key the server presents now. If it can't be reached,
    // keep the old pin, or pin on the first successful connection.
    let hostKey = pinnedHostKey ?? null;
    if (allow(`sftp-test:${session.shop}`)) {
      const probe = await testSftpConnection({
        host,
        port,
        username,
        targetDirectory,
        ...credentialToAuth(credential),
      });
      if (probe.ok && probe.hostKey) hostKey = probe.hostKey;
    }

    const data = {
      sftpHost: host,
      sftpPort: port,
      sftpUsername: username,
      targetDirectory,
      filenameTemplate,
      csvColumns: csvColumns === DEFAULT_COLUMN_SPEC ? null : csvColumns || null,
      sftpHostKey: hostKey,
      ...encryptCredential(credential, session.shop),
    };
    await db.merchantConfig.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, ...data },
      update: data,
    });
    return {
      ok: true,
      message: hostKey
        ? "Settings saved."
        : "Settings saved. The server's host key will be trusted on the first successful connection.",
    };
  }

  return { ok: false, message: "Unknown action." };
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

  const busy = fetcher.state !== "idle";
  const submittedIntent = fetcher.formData?.get("intent");
  const keepHint = (method: AuthMethod) =>
    saved.hasCredential && saved.authMethod === method
      ? "Leave blank to keep the saved value"
      : "";

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  const submit = (intent: "test" | "save") =>
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
        csvColumns,
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
          {fetcher.data?.ok && (
            <s-banner tone="success">{fetcher.data.message}</s-banner>
          )}
          <s-text-field
            label="Host"
            value={host}
            onInput={(e) => setHost(e.currentTarget.value)}
          />
          <s-text-field
            label="Port"
            value={port}
            onInput={(e) => setPort(e.currentTarget.value)}
          />
          <s-text-field
            label="Username"
            value={username}
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
              details={keepHint("password")}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          ) : (
            <>
              <s-text-area
                label="Private key"
                rows={6}
                value={privateKey}
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
            onInput={(e) => setTargetDirectory(e.currentTarget.value)}
          />
          <s-text-field
            label="File name"
            value={filenameTemplate}
            details={`Placeholders: ${saved.filenameTokens.map((t) => `{${t}}`).join(", ")}. Must include {order} or {order_id}.`}
            onInput={(e) => setFilenameTemplate(e.currentTarget.value)}
          />
          <s-text-area
            label="CSV columns"
            rows={8}
            value={csvColumns}
            details={`One column per line, in order. Add :Header to rename, e.g. sku:Item Code. Available: ${saved.availableColumns.join(", ")}.`}
            onInput={(e) => setCsvColumns(e.currentTarget.value)}
          />
          <s-paragraph>
            {saved.hostKey
              ? `Trusted server key: ${saved.hostKey}`
              : "The server's host key will be trusted on the first successful connection."}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button
              onClick={() => submit("test")}
              {...(busy && submittedIntent === "test" ? { loading: true } : {})}
              {...(busy ? { disabled: true } : {})}
            >
              Test connection
            </s-button>
            <s-button
              variant="primary"
              onClick={() => submit("save")}
              {...(busy && submittedIntent === "save" ? { loading: true } : {})}
              {...(busy ? { disabled: true } : {})}
            >
              Save settings
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
              <s-table-header>Error</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {saved.exports.map((e) => (
                <s-table-row key={e.id}>
                  <s-table-cell>{e.orderName}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={e.status === "success" ? "success" : "critical"}>
                      {e.status === "success" ? "Exported" : "Failed"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    {e.createdAt.slice(0, 16).replace("T", " ")} UTC
                  </s-table-cell>
                  <s-table-cell>{e.error ?? ""}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
