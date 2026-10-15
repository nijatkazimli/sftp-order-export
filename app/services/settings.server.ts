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
  orderToCsv,
  parseColumnSpec,
  renderFilename,
  validateFilenameTemplate,
} from "./orderCsv.server";
import { pruneExportJobs } from "./retention.server";
import { sampleOrder } from "./sampleOrder.server";
import { testSftpConnection, uploadCsvToSftp } from "./sftp.server";
import { allow } from "../utils/rateLimit.server";

const MAX_KEY_LENGTH = 16_384;
const RATE_LIMITED = "Too many connection attempts. Try again in a minute.";

export type FieldName =
  | "host"
  | "port"
  | "username"
  | "password"
  | "privateKey"
  | "targetDirectory"
  | "filenameTemplate"
  | "csvColumns";
export type FieldErrors = Partial<Record<FieldName, string>>;
export interface SampleFile {
  filename: string;
  csv: string;
}

export type ActionResult = {
  ok: boolean;
  message: string;
  /** Messages for individual form fields, shown next to them. */
  errors?: FieldErrors;
  preview?: SampleFile;
};

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
  confirmTest: boolean;
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

const hasErrors = (errors: FieldErrors) => Object.keys(errors).length > 0;

const invalid = (errors: FieldErrors): ActionResult => ({
  ok: false,
  message: "Fix the highlighted fields and try again.",
  errors,
});

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
    confirmTest: field("confirmTest") === "1",
  };
}

function validateEndpoint({ host, username, targetDirectory, port }: SettingsInput) {
  const errors: FieldErrors = {};
  if (!host) errors.host = "Enter the server host.";
  if (!username) errors.username = "Enter the username.";
  if (!targetDirectory) errors.targetDirectory = "Enter the folder to upload to.";
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = "Port must be between 1 and 65535.";
  }
  return errors;
}

function validateFormat({ filenameTemplate, csvColumns }: SettingsInput) {
  const errors: FieldErrors = {};
  const nameError = validateFilenameTemplate(filenameTemplate);
  if (nameError) errors.filenameTemplate = nameError;
  const columns = parseColumnSpec(csvColumns);
  if ("error" in columns) errors.csvColumns = columns.error;
  return errors;
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
): { credential: Credential } | { errors: FieldErrors } {
  const stored = reusableCredential(existing, endpointUnchanged);
  const missing = (field: "password" | "privateKey", what: string) => ({
    errors: {
      [field]:
        existing && !endpointUnchanged
          ? `Enter the ${what} again when the host, port or username changes.`
          : `The ${what} is required.`,
    },
  });

  if (input.authMethod === "password") {
    if (input.password) {
      return { credential: { method: "password", password: input.password } };
    }
    return stored?.method === "password"
      ? { credential: stored }
      : missing("password", "password");
  }

  if (input.privateKey) {
    if (!isValidPrivateKey(input.privateKey)) {
      return { errors: { privateKey: "Paste a valid private key (PEM format)." } };
    }
    return {
      credential: {
        method: "privateKey",
        privateKey: `${input.privateKey}\n`,
        passphrase: input.passphrase || undefined,
      },
    };
  }
  return stored?.method === "privateKey"
    ? { credential: stored }
    : missing("privateKey", "private key");
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
  if (!(await allow(db, `sftp-test:${shop}`))) return fail(RATE_LIMITED);
  const result = await testSftpConnection({
    ...connectionOf(ctx),
    expectedHostKey: ctx.pinnedHostKey,
  });
  if (!result.ok) return fail(`Connection failed: ${result.error}`);
  await pinFirstHostKey(db, shop, ctx, result.hostKey);
  return { ok: true, message: "Connection successful." };
}

/** Saving trusts the key the server presents now; if it can't be reached, the old pin stays. */
async function hostKeyToSave(
  db: PrismaClient,
  shop: string,
  ctx: SubmitContext,
): Promise<string | null> {
  const current = ctx.pinnedHostKey ?? null;
  if (!(await allow(db, `sftp-test:${shop}`))) return current;
  const probe = await testSftpConnection(connectionOf(ctx));
  return probe.ok && probe.hostKey ? probe.hostKey : current;
}

async function saveSettings(
  db: PrismaClient,
  shop: string,
  ctx: SubmitContext,
): Promise<ActionResult> {
  const { input } = ctx;
  const formatErrors = validateFormat(input);
  if (hasErrors(formatErrors)) return invalid(formatErrors);

  const hostKey = await hostKeyToSave(db, shop, ctx);
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

/** The sample order rendered with the file name and columns currently in the form. */
function buildSampleFile(
  input: SettingsInput,
): { file: SampleFile } | { errors: FieldErrors } {
  const errors = validateFormat(input);
  if (hasErrors(errors)) return { errors };
  const columns = parseColumnSpec(input.csvColumns);
  if ("error" in columns) return { errors: { csvColumns: columns.error } };
  const order = sampleOrder();
  return {
    file: {
      filename: renderFilename(input.filenameTemplate, order),
      csv: orderToCsv(order, columns.columns),
    },
  };
}

function previewFile(input: SettingsInput): ActionResult {
  const built = buildSampleFile(input);
  if ("errors" in built) return invalid(built.errors);
  return { ok: true, message: "Preview updated.", preview: built.file };
}

/** Uploads the sample file for real, so a supplier's automation may pick it up; hence the explicit confirmation. */
async function sendTestFile(
  db: PrismaClient,
  shop: string,
  ctx: SubmitContext,
): Promise<ActionResult> {
  if (!ctx.input.confirmTest) {
    return fail("Confirm that your supplier may process the test file before sending it.");
  }
  const built = buildSampleFile(ctx.input);
  if ("errors" in built) return invalid(built.errors);
  if (!(await allow(db, `sftp-test:${shop}`))) return fail(RATE_LIMITED);

  const { filename, csv } = built.file;
  try {
    const hostKey = await uploadCsvToSftp(
      { ...connectionOf(ctx), expectedHostKey: ctx.pinnedHostKey },
      filename,
      csv,
    );
    await pinFirstHostKey(db, shop, ctx, hostKey);
    return { ok: true, message: `Test file ${filename} was sent.` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    return fail(`Could not send the test file: ${reason}`);
  }
}

/** Handles the settings form: preview, test the connection, send a test file, or save. */
export async function submitSettings(
  db: PrismaClient,
  shop: string,
  form: FormData,
): Promise<ActionResult> {
  const input = readForm(form);
  // Needs no server details, so it works before the connection fields are filled in.
  if (input.intent === "preview") return previewFile(input);

  const endpointErrors = validateEndpoint(input);
  if (hasErrors(endpointErrors)) return invalid(endpointErrors);

  const existing = await db.merchantConfig.findUnique({ where: { shop } });
  // A stored secret is only reused for the endpoint it was saved for, so it
  // can't be redirected to another server by editing the host.
  const endpointUnchanged = existing ? sameEndpoint(existing, input) : false;
  const resolved = resolveCredential(input, existing, endpointUnchanged);
  if ("errors" in resolved) return invalid(resolved.errors);

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
    case "send-test":
      return sendTestFile(db, shop, ctx);
    case "save":
      return saveSettings(db, shop, ctx);
    default:
      return fail("Unknown action.");
  }
}
