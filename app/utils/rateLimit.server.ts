import type { PrismaClient } from "@prisma/client";

/**
 * Fixed-window limit kept in the database, so it holds across restarts and instances.
 * Rejected attempts still count but never extend the window.
 */
export async function allow(
  db: PrismaClient,
  key: string,
  limit = 10,
  windowMs = 60_000,
  now = new Date(),
): Promise<boolean> {
  const expired = new Date(now.getTime() - windowMs);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "windowStart" = CASE WHEN "RateLimit"."windowStart" <= ${expired}
        THEN ${now} ELSE "RateLimit"."windowStart" END,
      "count" = CASE WHEN "RateLimit"."windowStart" <= ${expired}
        THEN 1 ELSE "RateLimit"."count" + 1 END
    RETURNING "count"`;
  return row.count <= limit;
}
