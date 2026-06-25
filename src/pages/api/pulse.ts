import { env } from 'cloudflare:workers';
import type { APIRoute } from 'astro';
import { getSessionUserId } from '../../lib/auth';

export const GET: APIRoute = async () => {
  const db = (env as any).DB as D1Database;
  const { results: tasks } = await db.prepare("SELECT id, title, category, budget, location, city, lat, lng, created_at FROM tasks WHERE status = 'open' ORDER BY created_at DESC LIMIT 20").all();
  const { results: helpers } = await db.prepare("SELECT * FROM pulse WHERE last_seen > datetime('now', '-5 minutes')").all();

  const t = (tasks || []).map((t: any) => ({ ...t, _id: t.id, createdAt: t.created_at }));
  return new Response(JSON.stringify({ tasks: t, helpers: helpers || [] }));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { lat, lng } = await request.json();
  if (!lat || !lng) return new Response(JSON.stringify({ error: 'lat/lng required' }), { status: 400 });

  const user: any = await db.prepare("SELECT name, avatar, city FROM users WHERE id = ?").bind(session).first();
  await db.prepare("INSERT OR REPLACE INTO pulse (user_id, name, avatar, lat, lng, city, last_seen) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
    .bind(session, user?.name || 'Helper', user?.avatar || '', lat, lng, user?.city || '').run();

  return new Response(JSON.stringify({ ok: true }));
};

export const DELETE: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  await db.prepare("DELETE FROM pulse WHERE user_id = ?").bind(session).run();
  return new Response(JSON.stringify({ ok: true }));
};
