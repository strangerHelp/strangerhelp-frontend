import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

// GET /api/meets - list public meets + user's private meets
export const GET: APIRoute = async ({ url, cookies }) => {
  const db = (env as any).DB as D1Database;
  const session = await getSessionUserId(cookies);
  const code = url.searchParams.get('code'); // access private meet by invite code

  if (code) {
    const meet: any = await db.prepare("SELECT * FROM meets WHERE invite_code = ?").bind(code).first();
    if (!meet) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    const { results: attendees } = await db.prepare("SELECT user_id, user_name, joined_at FROM meet_attendees WHERE meet_id = ?").bind(meet.id).all();
    return new Response(JSON.stringify({ ...meet, attendees: attendees || [], attendeeCount: attendees?.length || 0 }));
  }

  // List public meets + private meets user hosts/joined
  let meets: any[] = [];
  const { results: publicMeets } = await db.prepare("SELECT * FROM meets WHERE visibility = 'public' ORDER BY created_at DESC LIMIT 30").all();
  meets = publicMeets || [];

  if (session) {
    const { results: myPrivate } = await db.prepare("SELECT m.* FROM meets m LEFT JOIN meet_attendees a ON a.meet_id = m.id WHERE m.visibility = 'private' AND (m.host_id = ? OR a.user_id = ?) GROUP BY m.id ORDER BY m.created_at DESC").bind(session, session).all();
    if (myPrivate) meets = [...meets, ...myPrivate.filter((m: any) => !meets.some((p: any) => p.id === m.id))];
  }

  // Get attendee counts
  const meetsWithCounts = await Promise.all(meets.map(async (m: any) => {
    const count: any = await db.prepare("SELECT COUNT(*) as c FROM meet_attendees WHERE meet_id = ?").bind(m.id).first();
    return { ...m, attendeeCount: count?.c || 0 };
  }));

  return new Response(JSON.stringify(meetsWithCounts));
};

// POST /api/meets - create a new meet
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();

  const formData = await request.formData();
  const title = formData.get('title') as string;
  const description = formData.get('description') as string || '';
  const category = formData.get('category') as string;
  const location = formData.get('location') as string || '';
  const date = formData.get('date') as string || '';
  const time = formData.get('time') as string || '';
  const visibility = formData.get('visibility') as string || 'public';
  const maxAttendees = parseInt(formData.get('max_attendees') as string) || 50;

  if (!title || !category) return new Response(JSON.stringify({ error: 'Title and category required' }), { status: 400 });
  if (title.length > 200) return new Response(JSON.stringify({ error: 'Title too long' }), { status: 400 });

  // Handle voice note
  const voiceFile = formData.get('voice_note') as File | null;
  let voiceNote = '';
  if (voiceFile && voiceFile.size > 0) voiceNote = await fileToDataUrl(voiceFile);

  const id = genId();
  const inviteCode = genId().slice(0, 8); // short invite code

  await db.prepare(
    "INSERT INTO meets (id, title, description, category, location, date, time, visibility, invite_code, max_attendees, host_id, host_name, voice_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, title, description, category, location, date, time, visibility, inviteCode, maxAttendees, session, user?.name || 'User', voiceNote).run();

  // Host auto-joins
  await db.prepare("INSERT INTO meet_attendees (id, meet_id, user_id, user_name) VALUES (?, ?, ?, ?)").bind(genId(), id, session, user?.name || 'User').run();

  return new Response(JSON.stringify({ id, inviteCode }), { status: 201 });
};
