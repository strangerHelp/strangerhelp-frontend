import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ params }) => {
  const db = (env as any).DB as D1Database;
  const question: any = await db.prepare("SELECT * FROM questions WHERE id = ?").bind(params.id).first();
  if (!question) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const { results: answers } = await db.prepare("SELECT * FROM answers WHERE question_id = ? ORDER BY votes DESC, created_at ASC LIMIT 200").bind(params.id).all();
  return new Response(JSON.stringify({ ...question, _id: question.id, posterId: question.poster_id, answers: answers || [] }));
};

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { action, text, vote } = await request.json() as any;

  const question: any = await db.prepare("SELECT id FROM questions WHERE id = ?").bind(params.id).first();
  if (!question) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  if (action === 'answer') {
    // Previously unvalidated: empty and unbounded answers could be inserted.
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) return new Response(JSON.stringify({ error: 'Answer text required' }), { status: 400 });
    if (body.length > 5000) return new Response(JSON.stringify({ error: 'Answer too long (max 5000 chars)' }), { status: 400 });

    const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
    const id = genId();
    await db.prepare("INSERT INTO answers (id, question_id, text, author_id, author_name) VALUES (?, ?, ?, ?, ?)")
      .bind(id, params.id, body, session, user?.name || 'User').run();
    return new Response(JSON.stringify({ ok: true, id }), { status: 201 });
  }

  if (action === 'vote') {
    if (vote !== 'up' && vote !== 'down') {
      return new Response(JSON.stringify({ error: "vote must be 'up' or 'down'" }), { status: 400 });
    }
    const inc = vote === 'up' ? 1 : -1;

    // One vote per user per question. Without this row, the endpoint could be
    // called repeatedly to drive a question's score arbitrarily up or down.
    const existing: any = await db.prepare("SELECT value FROM question_votes WHERE question_id = ? AND user_id = ?")
      .bind(params.id, session).first();

    if (existing) {
      if (existing.value === inc) {
        return new Response(JSON.stringify({ ok: true, unchanged: true }));
      }
      // Switching direction: undo the old vote and apply the new one.
      await db.prepare("UPDATE question_votes SET value = ? WHERE question_id = ? AND user_id = ?")
        .bind(inc, params.id, session).run();
      await db.prepare("UPDATE questions SET votes = votes + ? WHERE id = ?").bind(inc * 2, params.id).run();
      return new Response(JSON.stringify({ ok: true }));
    }

    await db.prepare("INSERT INTO question_votes (id, question_id, user_id, value) VALUES (?, ?, ?, ?)")
      .bind(genId(), params.id, session, inc).run();
    await db.prepare("UPDATE questions SET votes = votes + ? WHERE id = ?").bind(inc, params.id).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
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
  await db.prepare("DELETE FROM question_votes WHERE question_id = ?").bind(params.id).run();
  await db.prepare("DELETE FROM questions WHERE id = ?").bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }));
};
