import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ url, cookies }) => {
  const db = (env as any).DB as D1Database;
  const category = url.searchParams.get('category');
  const mine = url.searchParams.get('mine');
  const limit = parseInt(url.searchParams.get('limit') || '20');

  let query = '';
  const params: any[] = [];

  if (mine === 'true') {
    const session = await getSessionUserId(cookies);
    if (!session) return new Response(JSON.stringify([]), { status: 200 });
    query = "SELECT * FROM tasks WHERE poster_id = ? OR claimed_by = ? ORDER BY created_at DESC LIMIT ?";
    params.push(session, session, limit);
  } else {
    if (category && category !== 'All') {
      query = "SELECT * FROM tasks WHERE status = 'open' AND category = ? ORDER BY created_at DESC LIMIT ?";
      params.push(category, limit);
    } else {
      query = "SELECT * FROM tasks WHERE status = 'open' ORDER BY created_at DESC LIMIT ?";
      params.push(limit);
    }
  }

  const { results } = await db.prepare(query).bind(...params).all();
  const tasks = (results || []).map((t: any) => ({
    ...t, _id: t.id, posterId: t.poster_id, posterName: t.poster_name,
    claimedBy: t.claimed_by, claimedByName: t.claimed_by_name,
    completionProof: JSON.parse(t.completion_proof || '[]'),
    attachments: JSON.parse(t.attachments || '[]'), createdAt: t.created_at,
  }));

  return new Response(JSON.stringify(tasks));
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT name, city FROM users WHERE id = ?").bind(session).first();

  const formData = await request.formData();
  const title = formData.get('title') as string;
  const description = formData.get('description') as string || '';
  const category = formData.get('category') as string;
  const budget = formData.get('budget') as string;
  const deadline = formData.get('deadline') as string || 'Today';
  const location = formData.get('location') as string;
  const anonymous = formData.get('anonymous') === 'true' ? 1 : 0;
  const urgent = formData.get('urgent') === 'true' ? 1 : 0;
  const lat = parseFloat(formData.get('lat') as string) || null;
  const lng = parseFloat(formData.get('lng') as string) || null;

  if (!title || !category || !budget || !location) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }

  const files = formData.getAll('files') as File[];
  const attachments: string[] = [];
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl) attachments.push(dataUrl);
  }

  const id = genId();
  await db.prepare(
    "INSERT INTO tasks (id, title, description, category, budget, deadline, location, city, anonymous, urgent, lat, lng, attachments, poster_id, poster_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, title, description, category, parseInt(budget), deadline, location, user?.city || '', anonymous, urgent, lat, lng, JSON.stringify(attachments), session, user?.name || 'User').run();

  return new Response(JSON.stringify({ id }), { status: 201 });
};
