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
import { decrypt, encrypt } from "../utils/crypto.server";
import { testSftpConnection } from "../services/sftp.server";

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

  // The password is never sent back to the browser.
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
    hasPassword: Boolean(config),
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
  const password = field("password");
  const targetDirectory = field("targetDirectory").trim();

  if (!host || !username || !targetDirectory) {
    return { ok: false, message: "Host, username and target path are required." };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, message: "Port must be between 1 and 65535." };
  }

  const existing = await db.merchantConfig.findUnique({
    where: { shop: session.shop },
  });
  // A blank password field keeps the stored one.
  const effectivePassword =
    password ||
    (existing
      ? decrypt({
          encrypted: existing.sftpPasswordEncrypted,
          iv: existing.sftpIv,
        })
      : "");
  if (!effectivePassword) {
    return { ok: false, message: "Password is required." };
  }

  if (intent === "test") {
    const result = await testSftpConnection({
      host,
      port,
      username,
      password: effectivePassword,
      targetDirectory,
    });
    return result.ok
      ? { ok: true, message: "Connection successful." }
      : { ok: false, message: `Connection failed: ${result.error}` };
  }

  if (intent === "save") {
    const { encrypted, iv } = encrypt(effectivePassword);
    const data = {
      sftpHost: host,
      sftpPort: port,
      sftpUsername: username,
      sftpPasswordEncrypted: encrypted,
      sftpIv: iv,
      targetDirectory,
    };
    await db.merchantConfig.upsert({
      where: { shop: session.shop },
      create: { shop: session.shop, ...data },
      update: data,
    });
    return { ok: true, message: "Settings saved." };
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
  const [password, setPassword] = useState("");
  const [targetDirectory, setTargetDirectory] = useState(saved.targetDirectory);

  const busy = fetcher.state !== "idle";
  const submittedIntent = fetcher.formData?.get("intent");

  useEffect(() => {
    if (fetcher.data?.ok) shopify.toast.show(fetcher.data.message);
  }, [fetcher.data, shopify]);

  const submit = (intent: "test" | "save") =>
    fetcher.submit(
      { intent, host, port, username, password, targetDirectory },
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
          <s-password-field
            label="Password"
            value={password}
            details={
              saved.hasPassword ? "Leave blank to keep the saved password" : ""
            }
            onInput={(e) => setPassword(e.currentTarget.value)}
          />
          <s-text-field
            label="Target path"
            value={targetDirectory}
            onInput={(e) => setTargetDirectory(e.currentTarget.value)}
          />
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
