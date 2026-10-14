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

async function withClient<T>(
  config: SftpConfig,
  fn: (client: SftpClient) => Promise<T>,
): Promise<T> {
  const client = new SftpClient();
  try {
    await client.connect({
      host: config.host,
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
