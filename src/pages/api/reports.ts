import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { isAdmin } from '../../lib/admin';
import { getSessionUserId } from '../../lib/auth';
import { isRateLimited } from '../../lib/ratelimit';

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

  if (await isRateLimited(request, 'report')) {
    return new Response(JSON.stringify({ error: 'Too many reports. Try again later.' }), { status: 429 });
  }

  const db = (env as any).DB as D1Database;
  const body = await request.json() as any;

  const type = typeof body?.type === 'string' ? body.type.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  const description = typeof body?.description === 'string' ? body.description : '';
  const targetId = typeof body?.targetId === 'string' ? body.targetId.slice(0, 64) : null;

  if (!type || !reason) return new Response(JSON.stringify({ error: 'Type and reason required' }), { status: 400 });
  // Previously unbounded, so this endpoint could be used as free bulk storage.
  if (type.length > 50) return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400 });
  if (reason.length > 200) return new Response(JSON.stringify({ error: 'Reason too long (max 200 chars)' }), { status: 400 });
  if (description.length > 5000) return new Response(JSON.stringify({ error: 'Description too long (max 5000 chars)' }), { status: 400 });

  // 'verification' reports carry ID documents and are written only by
  // /api/auth/verify, so users must not be able to forge that type here.
  if (type === 'verification') return new Response(JSON.stringify({ error: 'Invalid type' }), { status: 400 });

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
  const id = genId();
  await db.prepare("INSERT INTO reports (id, reporter_id, reporter_name, type, target_id, reason, description) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, session, user?.name || 'User', type, targetId, reason, description).run();

  return new Response(JSON.stringify({ id }), { status: 201 });
};

const ALLOWED_REPORT_STATUS = ['open', 'reviewing', 'resolved', 'dismissed'];

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const db = (env as any).DB as D1Database;
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const { id, status, adminNote } = await request.json() as any;
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400 });
  if (!ALLOWED_REPORT_STATUS.includes(status)) {
    return new Response(JSON.stringify({ error: `status must be one of: ${ALLOWED_REPORT_STATUS.join(', ')}` }), { status: 400 });
  }

  await db.prepare("UPDATE reports SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, String(adminNote || '').slice(0, 2000), id).run();
  return new Response(JSON.stringify({ ok: true }));
};
