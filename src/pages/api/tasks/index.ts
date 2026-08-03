import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Cap on rows pulled for distance sorting, which must be computed in JS. */
const DISTANCE_CANDIDATE_CAP = 500;

const SORTS = new Set(['distance', 'newest', 'budget_high', 'budget_low', 'urgent']);
const STATUSES = new Set(['open', 'claimed', 'completed', 'all']);

/** Haversine distance in km. D1 has no SQL trig functions, so this runs here. */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function intParam(raw: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(raw || '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * Shape a task row for the client.
 *
 * `attachments` and `completionProof` hold base64 data URLs that can be
 * megabytes each. The feed never renders them, so the list only reports how
 * many there are; the detail endpoint still returns the full arrays.
 */
function mapListRow(t: any, distance?: number) {
  let attachmentCount = 0;
  let proofCount = 0;
  try { attachmentCount = (JSON.parse(t.attachments || '[]') as unknown[]).length; } catch {}
  try { proofCount = (JSON.parse(t.completion_proof || '[]') as unknown[]).length; } catch {}

  const mapped: any = {
    _id: t.id,
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    budget: t.budget,
    deadline: t.deadline,
    location: t.location,
    city: t.city,
    lat: t.lat,
    lng: t.lng,
    anonymous: t.anonymous,
    urgent: t.urgent,
    status: t.status,
    posterId: t.poster_id,
    posterName: t.poster_name,
    posterVerified: t.poster_verified === 1,
    claimedBy: t.claimed_by,
    claimedByName: t.claimed_by_name,
    maxClaimers: t.max_claimers || 1,
    completionStatus: t.completion_status || '',
    attachmentCount,
    proofCount,
    createdAt: t.created_at,
  };
  if (distance != null) mapped.distance = Math.round(distance * 100) / 100;
  return mapped;
}

// Columns needed by the feed. Deliberately excludes the base64 blob columns
// except for a length check, which keeps list responses small.
const LIST_COLUMNS = `
  t.id, t.title, t.description, t.category, t.budget, t.deadline, t.location, t.city,
  t.lat, t.lng, t.anonymous, t.urgent, t.status, t.poster_id, t.poster_name,
  t.claimed_by, t.claimed_by_name, t.max_claimers, t.completion_status, t.created_at,
  u.verified AS poster_verified,
  t.attachments, t.completion_proof
`;

export const GET: APIRoute = async ({ url, cookies, request }) => {
  const db = (env as any).DB as D1Database;
  const p = url.searchParams;

  const q = (p.get('q') || '').trim().slice(0, 100);
  const category = p.get('category');
  const mine = p.get('mine') === 'true';
  const sortRaw = p.get('sort') || 'distance';
  const sort = SORTS.has(sortRaw) ? sortRaw : 'distance';
  const statusRaw = p.get('status') || (mine ? 'all' : 'open');
  const status = STATUSES.has(statusRaw) ? statusRaw : 'open';
  const urgentOnly = p.get('urgent') === 'true';
  const verifiedOnly = p.get('verified') === 'true';
  const limit = intParam(p.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = intParam(p.get('offset'), 0, 0, 100_000);
  const minBudget = p.get('minBudget') ? intParam(p.get('minBudget'), 0, 0, 500_000) : null;
  const maxBudget = p.get('maxBudget') ? intParam(p.get('maxBudget'), 500_000, 0, 500_000) : null;
  const maxDistance = p.get('maxDistance') ? Math.min(Math.max(Number(p.get('maxDistance')) || 0, 0.1), 500) : null;

  // Resolve the viewer's coordinates: explicit params win, else Cloudflare's
  // IP geolocation, so distances work before the user grants GPS permission.
  // 0,0 is a real coordinate and is honoured when passed explicitly - the
  // fallback only applies when the params are absent or not numbers.
  let lat = Number(p.get('lat'));
  let lng = Number(p.get('lng'));
  if (p.get('lat') === null || p.get('lng') === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    const cf = (request as any).cf;
    lat = Number(cf?.latitude);
    lng = Number(cf?.longitude);
  }
  const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const where: string[] = [];
  const args: any[] = [];

  if (mine) {
    const session = await getSessionUserId(cookies);
    if (!session) {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Total-Count': '0', 'X-Has-More': 'false' },
      });
    }
    where.push('(t.poster_id = ? OR t.claimed_by = ?)');
    args.push(session, session);
  } else {
    // Public feed: exclude private tasks
    where.push("(t.visibility IS NULL OR t.visibility = 'public')");
  }

  if (status !== 'all') { where.push('t.status = ?'); args.push(status); }
  if (category && category !== 'All') { where.push('t.category = ?'); args.push(category); }
  if (urgentOnly) where.push('t.urgent = 1');
  if (verifiedOnly) where.push('u.verified = 1');
  if (minBudget != null) { where.push('t.budget >= ?'); args.push(minBudget); }
  if (maxBudget != null) { where.push('t.budget <= ?'); args.push(maxBudget); }

  // Server-side search. Previously the client filtered whatever 20 rows it had,
  // so anything outside the first page was silently unsearchable.
  if (q) {
    const like = `%${q.replace(/[%_]/g, (m) => '\\' + m)}%`;
    where.push(`(
      t.title LIKE ? ESCAPE '\\' OR
      t.description LIKE ? ESCAPE '\\' OR
      t.location LIKE ? ESCAPE '\\' OR
      t.city LIKE ? ESCAPE '\\' OR
      t.category LIKE ? ESCAPE '\\' OR
      (t.anonymous = 0 AND t.poster_name LIKE ? ESCAPE '\\')
    )`);
    args.push(like, like, like, like, like, like);
  }

  // Bounding-box prefilter. Cheap, index-friendly, and lets us bound the work
  // before the exact haversine pass below.
  if (hasLocation && maxDistance != null) {
    const dLat = maxDistance / 111.32;
    const cosLat = Math.max(Math.cos(lat * Math.PI / 180), 0.01);
    const dLng = maxDistance / (111.32 * cosLat);
    where.push('t.lat IS NOT NULL AND t.lng IS NOT NULL AND t.lat BETWEEN ? AND ? AND t.lng BETWEEN ? AND ?');
    args.push(lat - dLat, lat + dLat, lng - dLng, lng + dLng);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = `FROM tasks t LEFT JOIN users u ON t.poster_id = u.id ${whereSql}`;

  const totalRow: any = await db.prepare(`SELECT COUNT(*) AS c ${from}`).bind(...args).first();
  const total = totalRow?.c || 0;

  let tasks: any[];
  let hasMore: boolean;

  if (sort === 'distance' && hasLocation) {
    // Distance cannot be ordered in SQL (D1 has no trig functions), so pull a
    // bounded candidate set, measure exactly, then sort and page in memory.
    const { results } = await db.prepare(
      `SELECT ${LIST_COLUMNS} ${from} ORDER BY t.created_at DESC LIMIT ?`
    ).bind(...args, DISTANCE_CANDIDATE_CAP).all();

    const measured = (results || []).map((t: any) => {
      const d = (t.lat != null && t.lng != null) ? haversine(lat, lng, t.lat, t.lng) : null;
      return { row: t, d };
    });

    // Tasks without coordinates sort last rather than being dropped.
    measured.sort((a, b) => {
      if (a.d == null && b.d == null) return 0;
      if (a.d == null) return 1;
      if (b.d == null) return -1;
      return a.d - b.d;
    });

    const page = measured.slice(offset, offset + limit);
    tasks = page.map((m) => mapListRow(m.row, m.d ?? undefined));
    hasMore = offset + limit < measured.length;
  } else {
    const orderBy = {
      newest: 't.created_at DESC',
      budget_high: 't.budget DESC, t.created_at DESC',
      budget_low: 't.budget ASC, t.created_at DESC',
      urgent: 't.urgent DESC, t.created_at DESC',
      distance: 't.created_at DESC', // no coordinates available
    }[sort]!;

    const { results } = await db.prepare(
      `SELECT ${LIST_COLUMNS} ${from} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).bind(...args, limit, offset).all();

    tasks = (results || []).map((t: any) => {
      const d = (hasLocation && t.lat != null && t.lng != null) ? haversine(lat, lng, t.lat, t.lng) : undefined;
      return mapListRow(t, d);
    });
    hasMore = offset + tasks.length < total;
  }

  // Pagination travels in headers so the response body stays a bare array and
  // existing clients keep working.
  return new Response(JSON.stringify(tasks), {
    headers: {
      'Content-Type': 'application/json',
      'X-Total-Count': String(total),
      'X-Has-More': String(hasMore),
      'X-Offset': String(offset),
      'X-Limit': String(limit),
    },
  });
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
  const maxClaimers = parseInt(formData.get('max_claimers') as string) || 1;

  if (!title || !category || !budget || !location) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
  }
  if (title.length > 200) return new Response(JSON.stringify({ error: 'Title too long (max 200 chars)' }), { status: 400 });
  if (description.length > 5000) return new Response(JSON.stringify({ error: 'Description too long' }), { status: 400 });
  if (category.length > 100) return new Response(JSON.stringify({ error: 'Invalid category' }), { status: 400 });
  if (location.length > 300) return new Response(JSON.stringify({ error: 'Location too long' }), { status: 400 });
  const budgetNum = parseInt(budget);
  if (isNaN(budgetNum) || budgetNum < 1 || budgetNum > 500000) return new Response(JSON.stringify({ error: 'Invalid budget (₹1 - ₹5,00,000)' }), { status: 400 });
  if (maxClaimers < 1 || maxClaimers > 100) return new Response(JSON.stringify({ error: 'Helpers needed must be between 1 and 100' }), { status: 400 });

  const files = formData.getAll('files') as File[];
  if (files.length > 5) return new Response(JSON.stringify({ error: 'At most 5 attachments' }), { status: 400 });
  const attachments: string[] = [];
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl) attachments.push(dataUrl);
  }

  // Visibility: 'public' (default) or 'private' (only accessible via invite link)
  const visibilityRaw = (formData.get('visibility') as string || 'public').toLowerCase();
  const visibility = visibilityRaw === 'private' ? 'private' : 'public';
  const inviteCode = visibility === 'private' ? genId().slice(0, 10) : null;

  const id = genId();
  await db.prepare(
    "INSERT INTO tasks (id, title, description, category, budget, deadline, location, city, anonymous, urgent, lat, lng, max_claimers, attachments, poster_id, poster_name, visibility, invite_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, title, description, category, budgetNum, deadline, location, user?.city || '', anonymous, urgent, lat, lng, maxClaimers, JSON.stringify(attachments), session, user?.name || 'User', visibility, inviteCode).run();

  return new Response(JSON.stringify({ id, visibility, inviteCode }), { status: 201 });
};
