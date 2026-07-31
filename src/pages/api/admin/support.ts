import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import { isAdmin } from '../../../lib/admin';

// GET /api/admin/support - list all support conversations
export const GET: APIRoute = async ({ cookies }) => {
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const db = (env as any).DB as D1Database;
  const { results } = await db.prepare("SELECT c.id, c.participant_1 as user_id, c.participant_1_name as user_name, c.last_message, c.last_message_at FROM conversations c WHERE c.participant_2 = 'support' ORDER BY c.last_message_at DESC LIMIT 50").all();

  return new Response(JSON.stringify(results || []));
};

// POST /api/admin/support - reply to a support conversation
export const POST: APIRoute = async ({ request, cookies }) => {
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const db = (env as any).DB as D1Database;
  const { conversationId, text } = await request.json() as any;
  if (!conversationId || !text) return new Response(JSON.stringify({ error: 'conversationId and text required' }), { status: 400 });

  const message = String(text).trim();
  if (!message) return new Response(JSON.stringify({ error: 'text required' }), { status: 400 });
  if (message.length > 5000) return new Response(JSON.stringify({ error: 'Message too long' }), { status: 400 });

  // Only support threads may receive a message attributed to 'support'.
  // Without this, any conversation id would accept a spoofed Support Team message.
  const conv: any = await db.prepare("SELECT id FROM conversations WHERE id = ? AND participant_2 = 'support'")
    .bind(conversationId).first();
  if (!conv) return new Response(JSON.stringify({ error: 'Not a support conversation' }), { status: 404 });

  const msgId = genId();
  await db.prepare("INSERT INTO messages (id, conversation_id, sender_id, sender_name, text, type) VALUES (?, ?, 'support', 'Support Team', ?, 'text')")
    .bind(msgId, conversationId, message).run();

  await db.prepare("UPDATE conversations SET last_message = ?, last_message_at = datetime('now') WHERE id = ?")
    .bind(message.slice(0, 50), conversationId).run();

  return new Response(JSON.stringify({ ok: true }));
};
