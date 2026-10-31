import 'server-only';

/**
 * A small fixed-window rate limiter.
 *
 * HONEST ABOUT WHAT THIS IS: the counters live in process memory, so the limit
 * is per server instance and resets on deploy. On a single container - which is
 * how this app is meant to run - that is genuinely useful: it turns an
 * unlimited online password-guessing attack into a slow one. Behind several
 * replicas, or on a serverless platform that spins up many short-lived
 * instances, it degrades to "better than nothing" and should be replaced with
 * Redis or the platform's own limiter.
 *
 * It is here because the alternative - no limit at all on a login endpoint - is
 * the single most exploitable thing a small app can ship.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Stop the map growing without bound on a long-running process.
const MAX_KEYS = 10_000;

function sweep(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  for (const [key, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(key);
  }
  // Still too big - the process is under a key-flooding attack. Drop the lot
  // rather than exhaust memory; legitimate users just get a fresh window.
  if (buckets.size >= MAX_KEYS) buckets.clear();
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
  if (existing.count > limit) {
    return { ok: false, remaining: 0, retryAfterSeconds };
  }
  return { ok: true, remaining: limit - existing.count, retryAfterSeconds };
}

/**
 * Best-effort client identity.
 *
 * x-forwarded-for is client-controlled unless a trusted proxy overwrites it,
 * so this is a speed bump, not an identity. It is paired with a per-account
 * limit on login precisely because the IP alone cannot be trusted.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${scope}:${ip}`;
}

export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: 'Too many attempts. Wait a moment and try again.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
      },
    },
  );
}
