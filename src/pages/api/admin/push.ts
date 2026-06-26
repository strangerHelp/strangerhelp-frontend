import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAdmin } from '../../../lib/admin';
import { sendPushToAll } from '../../../lib/push';

// POST - send promotional push to all subscribers
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const { title, body, url } = await request.json();
  if (!title || !body) return new Response(JSON.stringify({ error: 'Title and body required' }), { status: 400 });

  const db = (env as any).DB as D1Database;
  const count: any = await db.prepare("SELECT COUNT(*) as c FROM push_subscriptions").first();

  await sendPushToAll(db, { title, body, url: url || '/tasks' });

  return new Response(JSON.stringify({ ok: true, sent: count?.c || 0 }));
};
