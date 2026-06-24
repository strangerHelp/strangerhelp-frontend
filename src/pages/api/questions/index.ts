import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';

export const GET: APIRoute = async ({ url, locals }) => {
  const db = (env as any).DB as D1Database;
  const category = url.searchParams.get('category');
  const query = category ? "SELECT * FROM questions WHERE category = ? ORDER BY created_at DESC LIMIT 20" : "SELECT * FROM questions ORDER BY created_at DESC LIMIT 20";
  const { results } = category ? await db.prepare(query).bind(category).all() : await db.prepare(query).all();
  const questions = (results || []).map((q: any) => ({ ...q, _id: q.id, posterId: q.poster_id, createdAt: q.created_at }));
  return new Response(JSON.stringify(questions));
};

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const { getSessionUserId } = await import('../../../lib/auth');
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { text, category, location, anonymous } = await request.json();
  if (!text || !category || !location) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });

  const id = genId();
  await db.prepare("INSERT INTO questions (id, text, category, location, anonymous, poster_id) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, text, category, location, anonymous ? 1 : 0, session).run();

  return new Response(JSON.stringify({ id }), { status: 201 });
};
