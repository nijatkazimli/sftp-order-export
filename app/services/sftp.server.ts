import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { posix } from "node:path";
import SftpClient from "ssh2-sftp-client";

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  targetDirectory: string;
}

export interface SftpTestResult {
  ok: boolean;
  error?: string;
}

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
  if (process.env.ALLOW_PRIVATE_SFTP_HOSTS !== "true") {
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
): Promise<T> {
  const client = new SftpClient();
  try {
    await client.connect({
      host: await resolvePublicAddress(config.host),
      port: config.port,
      username: config.username,
      password: config.password,
      readyTimeout: READY_TIMEOUT_MS,
    });
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function testSftpConnection(
  config: SftpConfig,
): Promise<SftpTestResult> {
  try {
    await withClient(config, async (client) => {
      const type = await client.exists(config.targetDirectory);
      if (type !== "d") {
        throw new Error(
          `Target directory "${config.targetDirectory}" does not exist`,
        );
      }
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Connection failed",
    };
  }
}

/** Throws on failure so callers (e.g. webhooks) can trigger a retry. */
export async function uploadCsvToSftp(
  config: SftpConfig,
  filename: string,
  csvContent: string,
): Promise<void> {
  const remotePath = posix.join(config.targetDirectory, posix.basename(filename));
  await withClient(config, (client) =>
    client.put(Buffer.from(csvContent, "utf8"), remotePath),
  );
}
