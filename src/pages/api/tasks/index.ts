import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ url, cookies, request }) => {
  const db = (env as any).DB as D1Database;
  const category = url.searchParams.get('category');
  const mine = url.searchParams.get('mine');
  const limit = parseInt(url.searchParams.get('limit') || '20');
  const userLat = parseFloat(url.searchParams.get('lat') || '');
  const userLng = parseFloat(url.searchParams.get('lng') || '');

  // Fallback: use Cloudflare's IP geolocation if no lat/lng provided
  let cfLat = userLat, cfLng = userLng;
  if (!cfLat || !cfLng) {
    const cf = (request as any).cf;
    if (cf?.latitude && cf?.longitude) {
      cfLat = parseFloat(cf.latitude);
      cfLng = parseFloat(cf.longitude);
    }
  }
  const hasLocation = !isNaN(cfLat) && !isNaN(cfLng);

  let query = '';
  const params: any[] = [];

  if (mine === 'true') {
    const session = await getSessionUserId(cookies);
    if (!session) return new Response(JSON.stringify([]), { status: 200 });
    query = "SELECT t.*, u.verified as poster_verified FROM tasks t LEFT JOIN users u ON t.poster_id = u.id WHERE t.poster_id = ? OR t.claimed_by = ? ORDER BY t.created_at DESC LIMIT ?";
    params.push(session, session, limit);
  } else {
    if (category && category !== 'All') {
      query = "SELECT t.*, u.verified as poster_verified FROM tasks t LEFT JOIN users u ON t.poster_id = u.id WHERE t.status = 'open' AND t.category = ? ORDER BY t.created_at DESC LIMIT ?";
      params.push(category, limit);
    } else {
      query = "SELECT t.*, u.verified as poster_verified FROM tasks t LEFT JOIN users u ON t.poster_id = u.id WHERE t.status = 'open' ORDER BY t.created_at DESC LIMIT ?";
      params.push(limit);
    }
  }

  const { results } = await db.prepare(query).bind(...params).all();
  let tasks = (results || []).map((t: any) => {
    const mapped: any = {
      ...t, _id: t.id, posterId: t.poster_id, posterName: t.poster_name,
      posterVerified: t.poster_verified === 1,
      claimedBy: t.claimed_by, claimedByName: t.claimed_by_name,
      completionProof: JSON.parse(t.completion_proof || '[]'),
      attachments: JSON.parse(t.attachments || '[]'), createdAt: t.created_at,
    };
    // Calculate distance if we have both user location and task location
    if (hasLocation && t.lat && t.lng) {
      mapped.distance = haversine(cfLat, cfLng, t.lat, t.lng);
    }
    return mapped;
  });

  // Sort by distance (nearest first) if location available, tasks without coords go to end
  if (hasLocation && mine !== 'true') {
    tasks.sort((a: any, b: any) => {
      if (a.distance == null && b.distance == null) return 0;
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      return a.distance - b.distance;
    });
  }

  return new Response(JSON.stringify(tasks));
};

// Haversine formula: returns distance in km
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

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

  const files = formData.getAll('files') as File[];
  const attachments: string[] = [];
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl) attachments.push(dataUrl);
  }

  const id = genId();
  await db.prepare(
    "INSERT INTO tasks (id, title, description, category, budget, deadline, location, city, anonymous, urgent, lat, lng, max_claimers, attachments, poster_id, poster_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, title, description, category, parseInt(budget), deadline, location, user?.city || '', anonymous, urgent, lat, lng, maxClaimers, JSON.stringify(attachments), session, user?.name || 'User').run();

  return new Response(JSON.stringify({ id }), { status: 201 });
};
