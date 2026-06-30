import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { getSessionUserId } from '../../lib/auth';

// POST /api/support - send message to support (creates/continues support conversation)
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { text } = await request.json();
  if (!text || text.trim().length === 0) return new Response(JSON.stringify({ error: 'Message required' }), { status: 400 });

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();

  // Find or create support conversation (participant_2 = 'support')
  let conv: any = await db.prepare("SELECT id FROM conversations WHERE participant_1 = ? AND participant_2 = 'support'").bind(session).first();

  if (!conv) {
    const convId = genId();
    await db.prepare("INSERT INTO conversations (id, task_id, participant_1, participant_2, participant_1_name, participant_2_name, last_message) VALUES (?, NULL, ?, 'support', ?, 'Support Team', ?)")
      .bind(convId, session, user?.name || 'User', text.slice(0, 50)).run();
    conv = { id: convId };
  }

  // Insert message
  const msgId = genId();
  await db.prepare("INSERT INTO messages (id, conversation_id, sender_id, sender_name, text, type) VALUES (?, ?, ?, ?, ?, 'text')")
    .bind(msgId, conv.id, session, user?.name || 'User', text).run();

  await db.prepare("UPDATE conversations SET last_message = ?, last_message_at = datetime('now') WHERE id = ?")
    .bind(text.slice(0, 50), conv.id).run();

  return new Response(JSON.stringify({ ok: true, conversationId: conv.id }));
};

// GET /api/support - get support conversation messages
export const GET: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const conv: any = await db.prepare("SELECT id FROM conversations WHERE participant_1 = ? AND participant_2 = 'support'").bind(session).first();
  if (!conv) return new Response(JSON.stringify({ messages: [], conversationId: null }));

  const { results } = await db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 100").bind(conv.id).all();
  const messages = (results || []).map((m: any) => ({
    _id: m.id, senderId: m.sender_id, senderName: m.sender_name, text: m.text, createdAt: m.created_at,
    isSupport: m.sender_id === 'support',
  }));

  return new Response(JSON.stringify({ messages, conversationId: conv.id }));
};
