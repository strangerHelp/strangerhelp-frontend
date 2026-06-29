import { env } from 'cloudflare:workers';

const WINDOW_SECONDS = 900; // 15 minutes
const MAX_ATTEMPTS = 10;

/** Returns true if rate limited. Uses CF-Connecting-IP header. */
export async function isRateLimited(request: Request, action: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
  const key = `${action}:${ip}`;
  const db = (env as any).DB as D1Database;

  try {
    // Use upsert pattern: single row per key with counter and window start
    const row: any = await db.prepare(
      "SELECT attempts, window_start FROM rate_limits WHERE key = ?"
    ).bind(key).first();

    const now = Math.floor(Date.now() / 1000);

    if (!row) {
      // First attempt - create entry
      await db.prepare(
        "INSERT OR REPLACE INTO rate_limits (key, attempts, window_start, created_at) VALUES (?, 1, ?, datetime('now'))"
      ).bind(key, now).run();
      return false;
    }

    const windowStart = row.window_start || 0;
    const elapsed = now - windowStart;

    if (elapsed > WINDOW_SECONDS) {
      // Window expired - reset
      await db.prepare(
        "UPDATE rate_limits SET attempts = 1, window_start = ?, created_at = datetime('now') WHERE key = ?"
      ).bind(now, key).run();
      return false;
    }

    if (row.attempts >= MAX_ATTEMPTS) {
      return true; // Rate limited
    }

    // Increment counter
    await db.prepare(
      "UPDATE rate_limits SET attempts = attempts + 1 WHERE key = ?"
    ).bind(key).run();
    return false;
  } catch {
    return false;
  }
}
