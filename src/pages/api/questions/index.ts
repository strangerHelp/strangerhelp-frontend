import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';
import { isRateLimited } from '../../../lib/ratelimit';

export const GET: APIRoute = async ({ url }) => {
  const db = (env as any).DB as D1Database;
  const category = url.searchParams.get('category');
  const query = category ? "SELECT * FROM questions WHERE category = ? ORDER BY created_at DESC LIMIT 20" : "SELECT * FROM questions ORDER BY created_at DESC LIMIT 20";
  const { results } = category ? await db.prepare(query).bind(category).all() : await db.prepare(query).all();
  const questions = (results || []).map((q: any) => ({ ...q, _id: q.id, posterId: q.poster_id, createdAt: q.created_at }));
  return new Response(JSON.stringify(questions));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  // Posting was previously unthrottled and unbounded, so a single account
  // could flood the questions table.
  if (await isRateLimited(request, 'question')) {
    return new Response(JSON.stringify({ error: 'Too many questions. Slow down.' }), { status: 429 });
  }

  const db = (env as any).DB as D1Database;
  const body = await request.json() as any;

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const category = typeof body?.category === 'string' ? body.category.trim() : '';
  const location = typeof body?.location === 'string' ? body.location.trim() : '';

  if (!text || !category || !location) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
  if (text.length > 2000) return new Response(JSON.stringify({ error: 'Question too long (max 2000 chars)' }), { status: 400 });
  if (category.length > 100) return new Response(JSON.stringify({ error: 'Category too long' }), { status: 400 });
  if (location.length > 200) return new Response(JSON.stringify({ error: 'Location too long' }), { status: 400 });

  const id = genId();
  await db.prepare("INSERT INTO questions (id, text, category, location, anonymous, poster_id) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, text, category, location, body?.anonymous ? 1 : 0, session).run();

  return new Response(JSON.stringify({ id }), { status: 201 });
};
