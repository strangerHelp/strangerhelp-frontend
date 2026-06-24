import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSessionUserId } from '../../../lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // Require ADMIN_SETUP_KEY env var to prevent anyone from becoming admin
  const { key } = await request.json();
  const setupKey = (env as any).ADMIN_SETUP_KEY;
  if (!setupKey || key !== setupKey) {
    return new Response(JSON.stringify({ error: 'Invalid setup key' }), { status: 403 });
  }

  const db = (env as any).DB as D1Database;
  await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(session).run();
  return new Response(JSON.stringify({ ok: true, message: 'You are now admin' }));
};
