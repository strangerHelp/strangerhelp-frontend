import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { results } = await db.prepare("SELECT * FROM conversations WHERE participant_1 = ? OR participant_2 = ? ORDER BY last_message_at DESC")
    .bind(session, session).all();

  const convs = (results || []).map((c: any) => ({
    _id: c.id, taskId: c.task_id,
    participants: [c.participant_1, c.participant_2],
    participantNames: [c.participant_1_name, c.participant_2_name],
    lastMessage: c.last_message, lastMessageAt: c.last_message_at, createdAt: c.created_at,
  }));
  return new Response(JSON.stringify(convs));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { recipientId, taskId } = await request.json();
  if (!recipientId) return new Response(JSON.stringify({ error: 'recipientId required' }), { status: 400 });

  const existing: any = await db.prepare(
    "SELECT * FROM conversations WHERE ((participant_1 = ? AND participant_2 = ?) OR (participant_1 = ? AND participant_2 = ?)) AND (task_id = ? OR ? IS NULL)"
  ).bind(session, recipientId, recipientId, session, taskId || null, taskId || null).first();

  if (existing) {
    return new Response(JSON.stringify({ _id: existing.id, taskId: existing.task_id, participants: [existing.participant_1, existing.participant_2], participantNames: [existing.participant_1_name, existing.participant_2_name] }));
  }

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
  const recipient: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(recipientId).first();

  const id = genId();
  await db.prepare("INSERT INTO conversations (id, task_id, participant_1, participant_2, participant_1_name, participant_2_name) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, taskId || null, session, recipientId, user?.name || 'User', recipient?.name || 'User').run();

  return new Response(JSON.stringify({ _id: id, taskId, participants: [session, recipientId], participantNames: [user?.name, recipient?.name] }), { status: 201 });
};
