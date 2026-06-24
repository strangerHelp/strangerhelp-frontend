import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { getSessionUserId } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const unreadOnly = url.searchParams.get('unread') === 'true';
  const query = unreadOnly
    ? "SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 20"
    : "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50";

  const { results } = await db.prepare(query).bind(session).all();
  const unreadCount = await db.prepare("SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0").bind(session).first();

  return new Response(JSON.stringify({ notifications: results || [], unreadCount: (unreadCount as any)?.c || 0 }));
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { id, all } = await request.json();

  if (all) {
    await db.prepare("UPDATE notifications SET read = 1 WHERE user_id = ?").bind(session).run();
  } else if (id) {
    await db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?").bind(id, session).run();
  }

  return new Response(JSON.stringify({ ok: true }));
};

// Helper: create notification (called from other API routes)
export async function createNotification(db: D1Database, userId: string, type: string, title: string, message: string, link: string) {
  const id = genId();
  await db.prepare("INSERT INTO notifications (id, user_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, userId, type, title, message, link).run();
}
