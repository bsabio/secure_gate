type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const BUCKET = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;

export function checkRateLimit(key: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = BUCKET.get(key);
  if (!entry || now >= entry.resetAt) {
    BUCKET.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= MAX_PER_WINDOW) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}
