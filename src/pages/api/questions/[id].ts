import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';

export const GET: APIRoute = async ({ params }) => {
  const db = (env as any).DB as D1Database;
  const question: any = await db.prepare("SELECT * FROM questions WHERE id = ?").bind(params.id).first();
  if (!question) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const { results: answers } = await db.prepare("SELECT * FROM answers WHERE question_id = ? ORDER BY votes DESC, created_at ASC").bind(params.id).all();
  return new Response(JSON.stringify({ ...question, _id: question.id, posterId: question.poster_id, answers: answers || [] }));
};

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const { getSessionUserId } = await import('../../../lib/auth');
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { action, text, vote } = await request.json();

  if (action === 'answer') {
    const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
    const id = genId();
    await db.prepare("INSERT INTO answers (id, question_id, text, author_id, author_name) VALUES (?, ?, ?, ?, ?)")
      .bind(id, params.id, text, session, user?.name || 'User').run();
  } else if (action === 'vote') {
    const inc = vote === 'up' ? 1 : -1;
    await db.prepare("UPDATE questions SET votes = votes + ? WHERE id = ?").bind(inc, params.id).run();
  }

  return new Response(JSON.stringify({ ok: true }));
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const { getSessionUserId } = await import('../../../lib/auth');
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT is_admin FROM users WHERE id = ?").bind(session).first();
  const question: any = await db.prepare("SELECT poster_id FROM questions WHERE id = ?").bind(params.id).first();
  if (!question) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  if (question.poster_id !== session && !user?.is_admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  await db.prepare("DELETE FROM answers WHERE question_id = ?").bind(params.id).run();
  await db.prepare("DELETE FROM questions WHERE id = ?").bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }));
};
