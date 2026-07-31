import { env } from 'cloudflare:workers';

const WINDOW_SECONDS = 900; // 15 minutes
const MAX_ATTEMPTS = 10;

/**
 * Returns true if the caller is rate limited.
 *
 * Only CF-Connecting-IP is trusted. x-forwarded-for is attacker-controlled and
 * was previously used as a fallback, so anyone could rotate that header to
 * bypass the limit entirely.
 */
export async function isRateLimited(request: Request, action: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip');

  // No trustworthy client IP (local dev, direct invocation). Skip limiting
  // rather than lumping every caller under a single shared "unknown" bucket.
  if (!ip) return false;

  const key = `${action}:${ip}`;
  const db = (env as any).DB as D1Database;
  const now = Math.floor(Date.now() / 1000);

  try {
    // Atomic upsert: increment within the window, reset once it has elapsed.
    // The previous read-then-write allowed concurrent requests to race past
    // the limit because the check and the increment were separate statements.
    await db.prepare(
      `INSERT INTO rate_limits (key, attempts, window_start, created_at)
       VALUES (?, 1, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         attempts = CASE WHEN ? - rate_limits.window_start > ? THEN 1 ELSE rate_limits.attempts + 1 END,
         window_start = CASE WHEN ? - rate_limits.window_start > ? THEN ? ELSE rate_limits.window_start END`
    ).bind(key, now, now, WINDOW_SECONDS, now, WINDOW_SECONDS, now).run();

    const row: any = await db.prepare("SELECT attempts FROM rate_limits WHERE key = ?").bind(key).first();
    return (row?.attempts || 0) > MAX_ATTEMPTS;
  } catch {
    // Fail closed on the endpoints this protects. Failing open meant a database
    // problem silently disabled brute-force protection on login and reset.
    return true;
  }
}
