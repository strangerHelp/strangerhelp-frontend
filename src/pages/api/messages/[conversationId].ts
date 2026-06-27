import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { createNotification } from '../notifications';
import { getSessionUserId } from '../../../lib/auth';
import { isRateLimited } from '../../../lib/ratelimit';

export const GET: APIRoute = async ({ params, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const conv: any = await db.prepare("SELECT * FROM conversations WHERE id = ? AND (participant_1 = ? OR participant_2 = ?)")
    .bind(params.conversationId, session, session).first();
  if (!conv) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const { results } = await db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 50")
    .bind(params.conversationId).all();

  const messages = (results || []).map((m: any) => ({
    _id: m.id, conversationId: m.conversation_id, senderId: m.sender_id,
    senderName: m.sender_name, text: m.text,
    attachments: JSON.parse(m.attachments || '[]'), type: m.type, createdAt: m.created_at,
  }));
  return new Response(JSON.stringify(messages));
};

export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  if (await isRateLimited(request, 'message')) return new Response(JSON.stringify({ error: 'Slow down' }), { status: 429 });

  const db = (env as any).DB as D1Database;
  const conv: any = await db.prepare("SELECT * FROM conversations WHERE id = ? AND (participant_1 = ? OR participant_2 = ?)")
    .bind(params.conversationId, session, session).first();
  if (!conv) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
  const contentType = request.headers.get('content-type') || '';

  let text = '';
  let attachments: string[] = [];
  let messageType = 'text';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    text = (formData.get('text') as string) || '';
    const files = formData.getAll('files') as File[];
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      if (dataUrl) attachments.push(dataUrl);
    }
    if (attachments.length > 0) messageType = 'image';
  } else {
    const body = await request.json();
    text = body.text || '';
  }

  if (!text && attachments.length === 0) return new Response(JSON.stringify({ error: 'Empty message' }), { status: 400 });
  if (text.length > 5000) return new Response(JSON.stringify({ error: 'Message too long' }), { status: 400 });

  const id = genId();
  await db.prepare("INSERT INTO messages (id, conversation_id, sender_id, sender_name, text, attachments, type) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, params.conversationId, session, user?.name || 'User', text, JSON.stringify(attachments), messageType).run();

  await db.prepare("UPDATE conversations SET last_message = ?, last_message_at = datetime('now') WHERE id = ?")
    .bind(text || '📎 Attachment', params.conversationId).run();

  const msg = { _id: id, conversationId: params.conversationId, senderId: session, senderName: user?.name || 'User', text, attachments, type: messageType, createdAt: new Date().toISOString() };

  const recipientId = conv.participant_1 === session ? conv.participant_2 : conv.participant_1;
  await createNotification(db, recipientId, 'new_message', 'New Message', `${user?.name || 'Someone'}: ${text || '📎 Attachment'}`, `/chat/${params.conversationId}`);

  return new Response(JSON.stringify(msg), { status: 201 });
};
