// Usage: npm run rotate-key (see "Rotating ENCRYPTION_KEY" in the README).
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { rotateKeys } from "../app/services/rotateKeys.server";

// Variables already in the environment win over .env.
if (existsSync(".env")) process.loadEnvFile();

const db = new PrismaClient();
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  console.log(`Database: ${url.hostname}${url.pathname}`);
  const { rewritten, current, failed } = await rotateKeys(db);
  console.log(
    `re-encrypted: ${rewritten}, already current: ${current}, failed: ${failed.length}`,
  );
  for (const line of failed) console.log(`  ${line}`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await db.$disconnect();
}
