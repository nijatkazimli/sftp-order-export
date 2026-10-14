import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { posix } from "node:path";
import SftpClient from "ssh2-sftp-client";

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  /** Set either password or privateKey. */
  password?: string;
  privateKey?: string;
  passphrase?: string;
  targetDirectory: string;
  /** `sha256:<hex>` fingerprint the server must present; unset means trust on first use. */
  expectedHostKey?: string;
}

export interface SftpTestResult {
  ok: boolean;
  error?: string;
  /** Fingerprint the server presented. */
  hostKey?: string;
}

export const HOST_KEY_CHANGED_MESSAGE =
  "The server's host key has changed since it was last trusted. If the server was changed or reinstalled, save the settings again to trust the new key.";

const READY_TIMEOUT_MS = 10_000;

const blocked = new BlockList();
// Reserved ranges are intentionally hardcoded (NOSONAR: S1313).
for (const [net, bits] of [
  ["0.0.0.0", 8], // NOSONAR
  ["10.0.0.0", 8], // NOSONAR
  ["100.64.0.0", 10], // NOSONAR
  ["127.0.0.0", 8], // NOSONAR
  ["169.254.0.0", 16], // NOSONAR
  ["172.16.0.0", 12], // NOSONAR
  ["192.0.0.0", 24], // NOSONAR
  ["192.168.0.0", 16], // NOSONAR
  ["198.18.0.0", 15], // NOSONAR
  ["224.0.0.0", 4], // NOSONAR
  ["240.0.0.0", 4], // NOSONAR
] as const) {
  blocked.addSubnet(net, bits, "ipv4");
}
for (const [net, bits] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7], // NOSONAR
  ["fe80::", 10], // NOSONAR
  ["ff00::", 8], // NOSONAR
] as const) {
  blocked.addSubnet(net, bits, "ipv6");
}

/** Resolves the host once and returns the IP to connect to, so DNS can't change between check and use. */
async function resolvePublicAddress(host: string): Promise<string> {
  const addresses = await lookup(host, { all: true, order: "ipv4first" });
  // The dev-only flag must never weaken protection in production.
  const allowPrivate =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_PRIVATE_SFTP_HOSTS === "true";
  if (!allowPrivate) {
    for (const { address, family } of addresses) {
      if (blocked.check(address, family === 6 ? "ipv6" : "ipv4")) {
        throw new Error("Host resolves to a private or reserved address");
      }
    }
  }
  return addresses[0].address;
}

async function withClient<T>(
  config: SftpConfig,
  fn: (client: SftpClient) => Promise<T>,
): Promise<{ result: T; hostKey: string }> {
  const client = new SftpClient();
  let hostKey = "";
  let mismatch = false;
  try {
    await client.connect({
      host: await resolvePublicAddress(config.host),
      port: config.port,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      passphrase: config.passphrase,
      readyTimeout: READY_TIMEOUT_MS,
      hostHash: "sha256",
      hostVerifier: (hash: string) => {
        hostKey = `sha256:${hash}`;
        mismatch = Boolean(config.expectedHostKey) && hostKey !== config.expectedHostKey;
        return !mismatch;
      },
    });
    return { result: await fn(client), hostKey };
  } catch (error) {
    if (mismatch) throw new Error(HOST_KEY_CHANGED_MESSAGE);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function testSftpConnection(
  config: SftpConfig,
): Promise<SftpTestResult> {
  try {
    const { hostKey } = await withClient(config, async (client) => {
      const type = await client.exists(config.targetDirectory);
      if (type !== "d") {
        throw new Error(
          `Target directory "${config.targetDirectory}" does not exist`,
        );
      }
    });
    return { ok: true, hostKey };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/** Throws on failure so callers (e.g. webhooks) can trigger a retry. Returns the server's host key fingerprint. */
export async function uploadCsvToSftp(
  config: SftpConfig,
  filename: string,
  csvContent: string,
): Promise<string> {
  const remotePath = posix.join(config.targetDirectory, posix.basename(filename));
  const { hostKey } = await withClient(config, (client) =>
    client.put(Buffer.from(csvContent, "utf8"), remotePath),
  );
  return hostKey;
}
