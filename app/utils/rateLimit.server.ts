const hits = new Map<string, number[]>();

/** In-memory sliding window; per process, which is enough for a single instance. */
export function allow(
  key: string,
  limit = 10,
  windowMs = 60_000,
  now = Date.now(),
): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
