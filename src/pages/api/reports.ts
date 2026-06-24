import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { isAdmin } from '../../lib/admin';
import { getSessionUserId } from '../../lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const admin = await isAdmin(cookies);
  const query = admin ? "SELECT * FROM reports ORDER BY created_at DESC LIMIT 50" : "SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC";
  const { results } = admin ? await db.prepare(query).all() : await db.prepare(query).bind(session).all();

  const reports = (results || []).map((r: any) => ({ ...r, _id: r.id, reporterId: r.reporter_id, reporterName: r.reporter_name, targetId: r.target_id, adminNote: r.admin_note, createdAt: r.created_at }));
  return new Response(JSON.stringify(reports));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { type, targetId, reason, description } = await request.json();
  if (!type || !reason) return new Response(JSON.stringify({ error: 'Type and reason required' }), { status: 400 });

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
  const id = genId();
  await db.prepare("INSERT INTO reports (id, reporter_id, reporter_name, type, target_id, reason, description) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, session, user?.name || 'User', type, targetId || null, reason, description || '').run();

  return new Response(JSON.stringify({ id }), { status: 201 });
};

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const db = (env as any).DB as D1Database;
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const { id, status, adminNote } = await request.json();
  await db.prepare("UPDATE reports SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?").bind(status, adminNote || '', id).run();
  return new Response(JSON.stringify({ ok: true }));
};
