import { env } from 'cloudflare:workers';

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10; // max attempts per window

/** Returns true if rate limited. Uses CF-Connecting-IP header. */
export async function isRateLimited(request: Request, action: string): Promise<boolean> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${action}:${ip}`;
  const db = (env as any).DB as D1Database;

  try {
    const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
    // Clean old entries and count recent
    await db.prepare("DELETE FROM rate_limits WHERE created_at < ?").bind(cutoff).run();
    const row: any = await db.prepare("SELECT COUNT(*) as cnt FROM rate_limits WHERE key = ? AND created_at > ?").bind(key, cutoff).first();

    if ((row?.cnt || 0) >= MAX_ATTEMPTS) return true;

    await db.prepare("INSERT INTO rate_limits (key, created_at) VALUES (?, datetime('now'))").bind(key).run();
    return false;
  } catch {
    // If table doesn't exist yet, don't block requests
    return false;
  }
}
