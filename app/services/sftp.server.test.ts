import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  connect: vi.fn(),
  exists: vi.fn(),
  put: vi.fn(),
  end: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("ssh2-sftp-client", () => ({
  default: class {
    connect = mocks.connect;
    exists = mocks.exists;
    put = mocks.put;
    end = mocks.end;
  },
}));

import { testSftpConnection, uploadCsvToSftp } from "./sftp.server";

const config = {
  host: "sftp.example.com",
  port: 22,
  username: "u",
  password: randomUUID(),
  targetDirectory: "/upload",
};

const resolvesTo = (address: string, family = 4) =>
  mocks.lookup.mockResolvedValue([{ address, family }]);

beforeEach(() => {
  vi.resetAllMocks();
  // Don't let a developer's shell environment weaken the SSRF tests.
  vi.stubEnv("ALLOW_PRIVATE_SFTP_HOSTS", "");
  mocks.connect.mockResolvedValue(undefined);
  mocks.exists.mockResolvedValue("d");
  mocks.put.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("SSRF guard", () => {
  it.each([
    ["127.0.0.1", 4],
    ["10.1.2.3", 4],
    ["172.16.0.1", 4],
    ["192.168.1.1", 4],
    ["169.254.169.254", 4],
    ["100.64.0.1", 4],
    ["0.0.0.0", 4],
    ["::1", 6],
    ["fc00::1", 6],
    ["fe80::1", 6],
    ["::ffff:127.0.0.1", 6],
  ])("blocks %s", async (address, family) => {
    resolvesTo(address, family);
    const result = await testSftpConnection(config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private or reserved/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("blocks when any resolved address is private", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    expect((await testSftpConnection(config)).ok).toBe(false);
  });

  it("allows private hosts when the dev flag is set", async () => {
    vi.stubEnv("ALLOW_PRIVATE_SFTP_HOSTS", "true");
    resolvesTo("127.0.0.1");
    expect((await testSftpConnection(config)).ok).toBe(true);
  });

  it("ignores the dev flag in production", async () => {
    vi.stubEnv("ALLOW_PRIVATE_SFTP_HOSTS", "true");
    vi.stubEnv("NODE_ENV", "production");
    resolvesTo("127.0.0.1");
    const result = await testSftpConnection(config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/private or reserved/);
  });

  it("connects to the resolved IP, not the hostname", async () => {
    resolvesTo("93.184.216.34");
    await testSftpConnection(config);
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: "93.184.216.34" }),
    );
  });
});

describe("testSftpConnection", () => {
  it("returns the host key the server presented", async () => {
    resolvesTo("93.184.216.34");
    mocks.connect.mockImplementation(async (opts: { hostVerifier: (h: string) => boolean }) => {
      opts.hostVerifier("abc123");
    });
    expect(await testSftpConnection(config)).toEqual({
      ok: true,
      hostKey: "sha256:abc123",
    });
  });

  it("accepts a connection whose key matches the pinned one", async () => {
    resolvesTo("93.184.216.34");
    mocks.connect.mockImplementation(async (opts: { hostVerifier: (h: string) => boolean }) => {
      if (!opts.hostVerifier("abc123")) throw new Error("Host denied");
    });
    const result = await testSftpConnection({
      ...config,
      expectedHostKey: "sha256:abc123",
    });
    expect(result.ok).toBe(true);
  });

  it("refuses a server whose key changed", async () => {
    resolvesTo("93.184.216.34");
    mocks.connect.mockImplementation(async (opts: { hostVerifier: (h: string) => boolean }) => {
      if (!opts.hostVerifier("evil")) throw new Error("Host denied");
    });
    const result = await testSftpConnection({
      ...config,
      expectedHostKey: "sha256:abc123",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/host key has changed/);
    expect(mocks.end).toHaveBeenCalled();
  });
  it("authenticates with a private key and passphrase when given", async () => {
    resolvesTo("93.184.216.34");
    await testSftpConnection({
      ...config,
      password: undefined,
      privateKey: "KEY",
      passphrase: "pp",
    });
    expect(mocks.connect).toHaveBeenCalledWith(
      expect.objectContaining({
        privateKey: "KEY",
        passphrase: "pp",
        password: undefined,
      }),
    );
  });
  it("fails when the target directory is missing", async () => {
    resolvesTo("93.184.216.34");
    mocks.exists.mockResolvedValue(false);
    const result = await testSftpConnection(config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not exist/);
    expect(mocks.end).toHaveBeenCalled();
  });

  it("returns the error and closes the connection on failure", async () => {
    resolvesTo("93.184.216.34");
    mocks.connect.mockRejectedValue(new Error("auth failed"));
    expect(await testSftpConnection(config)).toEqual({
      ok: false,
      error: "auth failed",
    });
    expect(mocks.end).toHaveBeenCalled();
  });
});

describe("uploadCsvToSftp", () => {
  it("gives up and closes the connection when the server stalls after login", async () => {
    vi.useFakeTimers();
    try {
      resolvesTo("203.0.113.10");
      mocks.put.mockReturnValue(new Promise(() => undefined));
      const result = uploadCsvToSftp(config, "a.csv", "x");
      const assertion = expect(result).rejects.toThrow(/did not finish within 60 seconds/);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(mocks.end).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uploads into the target directory and strips path segments from the filename", async () => {
    resolvesTo("93.184.216.34");
    mocks.connect.mockImplementation(async (opts: { hostVerifier: (h: string) => boolean }) => {
      opts.hostVerifier("abc123");
    });
    const hostKey = await uploadCsvToSftp(config, "../../etc/evil.csv", "a,b");
    expect(hostKey).toBe("sha256:abc123");
    expect(mocks.put).toHaveBeenCalledWith(
      Buffer.from("a,b"),
      "/upload/evil.csv",
    );
    expect(mocks.end).toHaveBeenCalled();
  });

  it("throws on failure so the caller can retry", async () => {
    resolvesTo("93.184.216.34");
    mocks.put.mockRejectedValue(new Error("disk full"));
    await expect(uploadCsvToSftp(config, "o.csv", "x")).rejects.toThrow(
      "disk full",
    );
    expect(mocks.end).toHaveBeenCalled();
  });
});
