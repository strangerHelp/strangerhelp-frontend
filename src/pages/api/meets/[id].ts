import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

// GET /api/meets/[id]
export const GET: APIRoute = async ({ params, cookies }) => {
  const db = (env as any).DB as D1Database;
  const session = await getSessionUserId(cookies);
  const meet: any = await db.prepare("SELECT * FROM meets WHERE id = ? OR invite_code = ?").bind(params.id, params.id).first();
  if (!meet) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  // Private meets: only host, attendees, or anyone with the link (invite_code in URL)
  if (meet.visibility === 'private' && session !== meet.host_id) {
    const isAttendee: any = session ? await db.prepare("SELECT id FROM meet_attendees WHERE meet_id = ? AND user_id = ?").bind(meet.id, session).first() : null;
    if (!isAttendee && params.id !== meet.invite_code) {
      return new Response(JSON.stringify({ error: 'Private meet. Use invite link to access.' }), { status: 403 });
    }
  }

  const { results: attendees } = await db.prepare("SELECT user_id, user_name, joined_at FROM meet_attendees WHERE meet_id = ?").bind(meet.id).all();
  return new Response(JSON.stringify({ ...meet, attendees: attendees || [], attendeeCount: attendees?.length || 0 }));
};

// POST /api/meets/[id] - join or leave
export const POST: APIRoute = async ({ params, request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { action } = await request.json();
  const meet: any = await db.prepare("SELECT * FROM meets WHERE id = ? OR invite_code = ?").bind(params.id, params.id).first();
  if (!meet) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();

  if (action === 'join') {
    const existing: any = await db.prepare("SELECT id FROM meet_attendees WHERE meet_id = ? AND user_id = ?").bind(meet.id, session).first();
    if (existing) return new Response(JSON.stringify({ error: 'Already joined' }), { status: 409 });
    const count: any = await db.prepare("SELECT COUNT(*) as c FROM meet_attendees WHERE meet_id = ?").bind(meet.id).first();
    if ((count?.c || 0) >= meet.max_attendees) return new Response(JSON.stringify({ error: 'Meet is full' }), { status: 400 });
    await db.prepare("INSERT INTO meet_attendees (id, meet_id, user_id, user_name) VALUES (?, ?, ?, ?)").bind(genId(), meet.id, session, user?.name || 'User').run();
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'leave') {
    if (session === meet.host_id) return new Response(JSON.stringify({ error: 'Host cannot leave' }), { status: 400 });
    await db.prepare("DELETE FROM meet_attendees WHERE meet_id = ? AND user_id = ?").bind(meet.id, session).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
};

// DELETE /api/meets/[id] - host or admin only
export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const db = (env as any).DB as D1Database;
  const meet: any = await db.prepare("SELECT host_id FROM meets WHERE id = ?").bind(params.id).first();
  if (!meet) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  const user: any = await db.prepare("SELECT is_admin FROM users WHERE id = ?").bind(session).first();
  if (meet.host_id !== session && !user?.is_admin) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  await db.prepare("DELETE FROM meet_attendees WHERE meet_id = ?").bind(params.id).run();
  await db.prepare("DELETE FROM meets WHERE id = ?").bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }));
};
