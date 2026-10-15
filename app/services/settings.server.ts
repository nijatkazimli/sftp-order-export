import type { MerchantConfig, PrismaClient } from "@prisma/client";
import {
  credentialToAuth,
  decryptCredential,
  encryptCredential,
  sameEndpoint,
  type AuthMethod,
  type Credential,
} from "./credentials.server";
import type { ExportTrigger } from "./exportQueue.constants";
import {
  COLUMN_KEYS,
  DEFAULT_COLUMN_SPEC,
  DEFAULT_FILENAME_TEMPLATE,
  FILENAME_TOKENS,
  parseColumnSpec,
  validateFilenameTemplate,
} from "./orderCsv.server";
import { pruneExportJobs } from "./retention.server";
import { testSftpConnection } from "./sftp.server";
import { allow } from "../utils/rateLimit.server";

const MAX_KEY_LENGTH = 16_384;

export type ActionResult = { ok: boolean; message: string };

/** Everything the settings page shows. Secrets are never included. */
export async function loadSettingsView(db: PrismaClient, shop: string) {
  pruneExportJobs(db).catch((e) => console.error("Failed to prune export jobs", e));
  const config = await db.merchantConfig.findUnique({ where: { shop } });
  const exports = await db.exportJob.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return {
    exports: exports.map((e) => ({
      id: e.id,
      orderName: e.orderName,
      status: e.status,
      attempts: e.attempts,
      error: e.lastError,
      createdAt: e.createdAt.toISOString(),
    })),
    host: config?.sftpHost ?? "",
    port: config?.sftpPort ?? 22,
    username: config?.sftpUsername ?? "",
    targetDirectory: config?.targetDirectory ?? "/upload",
    filenameTemplate: config?.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE,
    exportTrigger: (config?.exportTrigger ?? "created") as ExportTrigger,
    csvColumns: config?.csvColumns ?? DEFAULT_COLUMN_SPEC,
    availableColumns: COLUMN_KEYS,
    filenameTokens: FILENAME_TOKENS,
    authMethod: (config?.authMethod ?? "password") as AuthMethod,
    hasCredential: Boolean(config),
    hostKey: config?.sftpHostKey ?? null,
  };
}

interface SettingsInput {
  intent: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password: string;
  privateKey: string;
  passphrase: string;
  targetDirectory: string;
  filenameTemplate: string;
  exportTrigger: ExportTrigger;
  csvColumns: string;
}

interface SubmitContext {
  input: SettingsInput;
  existing: MerchantConfig | null;
  endpointUnchanged: boolean;
  /** Host key to enforce; only for the server the settings were saved for. */
  pinnedHostKey: string | undefined;
  credential: Credential;
}

const fail = (message: string): ActionResult => ({ ok: false, message });

function readForm(form: FormData): SettingsInput {
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    intent: field("intent"),
    host: field("host").trim(),
    port: Number(field("port")),
    username: field("username").trim(),
    authMethod: field("authMethod") === "privateKey" ? "privateKey" : "password",
    password: field("password"),
    privateKey: field("privateKey").trim(),
    passphrase: field("passphrase"),
    targetDirectory: field("targetDirectory").trim(),
    filenameTemplate: field("filenameTemplate").trim() || DEFAULT_FILENAME_TEMPLATE,
    exportTrigger: field("exportTrigger") === "paid" ? "paid" : "created",
    csvColumns: field("csvColumns").replaceAll("\r\n", "\n").trim(),
  };
}

function validateEndpoint({ host, username, targetDirectory, port }: SettingsInput) {
  if (!host || !username || !targetDirectory) {
    return "Host, username and target path are required.";
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return "Port must be between 1 and 65535.";
  }
  return null;
}

function validateFormat({ filenameTemplate, csvColumns }: SettingsInput) {
  const columns = parseColumnSpec(csvColumns);
  return (
    validateFilenameTemplate(filenameTemplate) ??
    ("error" in columns ? columns.error : null)
  );
}

/** The saved secret, if it may be reused: same server and still decryptable. */
function reusableCredential(
  existing: MerchantConfig | null,
  endpointUnchanged: boolean,
): Credential | undefined {
  if (!existing || !endpointUnchanged) return undefined;
  try {
    return decryptCredential(existing);
  } catch {
    // Unreadable (e.g. key changed): the secret has to be entered again.
    return undefined;
  }
}

const isValidPrivateKey = (key: string) =>
  key.length <= MAX_KEY_LENGTH && key.includes("PRIVATE KEY");

/** A typed secret wins; a blank field keeps the saved one of the same method. */
function resolveCredential(
  input: SettingsInput,
  existing: MerchantConfig | null,
  endpointUnchanged: boolean,
): { credential: Credential } | { error: string } {
  const stored = reusableCredential(existing, endpointUnchanged);
  const missing = (what: string) => ({
    error:
      existing && !endpointUnchanged
        ? `Enter the ${what} again when the host, port or username changes.`
        : `The ${what} is required.`,
  });

  if (input.authMethod === "password") {
    if (input.password) {
      return { credential: { method: "password", password: input.password } };
    }
    return stored?.method === "password" ? { credential: stored } : missing("password");
  }

  if (input.privateKey) {
    if (!isValidPrivateKey(input.privateKey)) {
      return { error: "Paste a valid private key (PEM format)." };
    }
    return {
      credential: {
        method: "privateKey",
        privateKey: `${input.privateKey}\n`,
        passphrase: input.passphrase || undefined,
      },
    };
  }
  return stored?.method === "privateKey" ? { credential: stored } : missing("private key");
}

const connectionOf = ({ input, credential }: SubmitContext) => ({
  host: input.host,
  port: input.port,
  username: input.username,
  targetDirectory: input.targetDirectory,
  ...credentialToAuth(credential),
});

/** Trust on first use: remember the key of a saved server that has none yet. */
async function pinFirstHostKey(
  db: PrismaClient,
  shop: string,
  { existing, endpointUnchanged }: SubmitContext,
  hostKey: string | undefined,
) {
  if (!existing || !endpointUnchanged || existing.sftpHostKey || !hostKey) return;
  await db.merchantConfig.update({ where: { shop }, data: { sftpHostKey: hostKey } });
}

async function testConnection(
  db: PrismaClient,
  shop: string,
  ctx: SubmitContext,
): Promise<ActionResult> {
  if (!allow(`sftp-test:${shop}`)) {
    return fail("Too many connection attempts. Try again in a minute.");
  }
  const result = await testSftpConnection({
    ...connectionOf(ctx),
    expectedHostKey: ctx.pinnedHostKey,
  });
  if (!result.ok) return fail(`Connection failed: ${result.error}`);
  await pinFirstHostKey(db, shop, ctx, result.hostKey);
  return { ok: true, message: "Connection successful." };
}

/** Saving trusts the key the server presents now; if it can't be reached, the old pin stays. */
async function hostKeyToSave(shop: string, ctx: SubmitContext): Promise<string | null> {
  const current = ctx.pinnedHostKey ?? null;
  if (!allow(`sftp-test:${shop}`)) return current;
  const probe = await testSftpConnection(connectionOf(ctx));
  return probe.ok && probe.hostKey ? probe.hostKey : current;
}

async function saveSettings(
  db: PrismaClient,
  shop: string,
  ctx: SubmitContext,
): Promise<ActionResult> {
  const { input } = ctx;
  const formatError = validateFormat(input);
  if (formatError) return fail(formatError);

  const hostKey = await hostKeyToSave(shop, ctx);
  const data = {
    sftpHost: input.host,
    sftpPort: input.port,
    sftpUsername: input.username,
    targetDirectory: input.targetDirectory,
    filenameTemplate: input.filenameTemplate,
    exportTrigger: input.exportTrigger,
    csvColumns:
      input.csvColumns === DEFAULT_COLUMN_SPEC ? null : input.csvColumns || null,
    sftpHostKey: hostKey,
    ...encryptCredential(ctx.credential, shop),
  };
  await db.merchantConfig.upsert({
    where: { shop },
    create: { shop, ...data },
    update: data,
  });
  return {
    ok: true,
    message: hostKey
      ? "Settings saved."
      : "Settings saved. The server's host key will be trusted on the first successful connection.",
  };
}

/** Handles the settings form: "test" checks the connection, "save" stores the settings. */
export async function submitSettings(
  db: PrismaClient,
  shop: string,
  form: FormData,
): Promise<ActionResult> {
  const input = readForm(form);
  const inputError = validateEndpoint(input);
  if (inputError) return fail(inputError);

  const existing = await db.merchantConfig.findUnique({ where: { shop } });
  // A stored secret is only reused for the endpoint it was saved for, so it
  // can't be redirected to another server by editing the host.
  const endpointUnchanged = existing ? sameEndpoint(existing, input) : false;
  const resolved = resolveCredential(input, existing, endpointUnchanged);
  if ("error" in resolved) return fail(resolved.error);

  const ctx: SubmitContext = {
    input,
    existing,
    endpointUnchanged,
    pinnedHostKey: endpointUnchanged ? (existing?.sftpHostKey ?? undefined) : undefined,
    credential: resolved.credential,
  };

  switch (input.intent) {
    case "test":
      return testConnection(db, shop, ctx);
    case "save":
      return saveSettings(db, shop, ctx);
    default:
      return fail("Unknown action.");
  }
}
