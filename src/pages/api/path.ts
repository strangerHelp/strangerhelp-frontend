import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { getSessionUserId } from '../../lib/auth';
import { createNotification } from './notifications';

// GET /api/path - get matched tasks along user's active path
export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;

  // Get user's active path
  const path: any = await db.prepare("SELECT * FROM paths WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1").bind(session).first();
  if (!path) return new Response(JSON.stringify({ path: null, tasks: [] }));

  // Find open tasks within radius of the path (simplified: check distance from both from/to points)
  const { results: tasks } = await db.prepare("SELECT id, title, description, category, budget, deadline, location, lat, lng, urgent, status, poster_id, poster_name, created_at FROM tasks WHERE status = 'open' AND lat IS NOT NULL AND lng IS NOT NULL").all();

  // Calculate which tasks are near the path
  const matchedTasks = (tasks || []).filter((t: any) => {
    const distFromStart = haversine(path.from_lat, path.from_lng, t.lat, t.lng);
    const distFromEnd = haversine(path.to_lat, path.to_lng, t.lat, t.lng);
    const pathLength = haversine(path.from_lat, path.from_lng, path.to_lat, path.to_lng);
    // Task is "on path" if it's within radius of the line between start and end
    // Simplified: within radius of either endpoint OR closer to path than radius
    const minDist = Math.min(distFromStart, distFromEnd);
    // Also check if task is between start and end (not behind)
    const onSegment = (distFromStart + distFromEnd) < (pathLength + path.radius_km * 2);
    return onSegment && minDist <= path.radius_km * 3;
  }).map((t: any) => {
    const distFromStart = haversine(path.from_lat, path.from_lng, t.lat, t.lng);
    const distFromEnd = haversine(path.to_lat, path.to_lng, t.lat, t.lng);
    const pathLength = haversine(path.from_lat, path.from_lng, path.to_lat, path.to_lng);
    // Approximate distance off-path
    const s = (distFromStart + distFromEnd + pathLength) / 2;
    const area = Math.sqrt(Math.max(0, s * (s - distFromStart) * (s - distFromEnd) * (s - pathLength)));
    const offPath = pathLength > 0 ? (2 * area) / pathLength : distFromStart;
    return { ...t, _id: t.id, offPath: Math.round(offPath * 10) / 10, distFromStart: Math.round(distFromStart * 10) / 10 };
  }).filter((t: any) => t.offPath <= path.radius_km)
    .sort((a: any, b: any) => a.distFromStart - b.distFromStart);

  return new Response(JSON.stringify({ path, tasks: matchedTasks }));
};

// POST /api/path - set a new path
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { from_location, from_lat, from_lng, to_location, to_lat, to_lng, radius_km, recurring } = await request.json() as any;

  if (!from_location || !to_location || !from_lat || !from_lng || !to_lat || !to_lng) {
    return new Response(JSON.stringify({ error: 'From and To locations required' }), { status: 400 });
  }

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();

  // Deactivate old paths
  await db.prepare("UPDATE paths SET active = 0 WHERE user_id = ?").bind(session).run();

  const id = genId();
  const radius = Math.min(Math.max(radius_km || 1, 0.5), 5); // 0.5 to 5 km
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // expires in 24h

  await db.prepare("INSERT INTO paths (id, user_id, user_name, from_location, from_lat, from_lng, to_location, to_lat, to_lng, radius_km, recurring, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, session, user?.name || 'User', from_location, from_lat, from_lng, to_location, to_lat, to_lng, radius, recurring ? 1 : 0, expiresAt).run();

  // Notify posters whose tasks are along this path
  const { results: openTasks } = await db.prepare("SELECT id, title, poster_id, lat, lng FROM tasks WHERE status = 'open' AND lat IS NOT NULL AND lng IS NOT NULL AND poster_id != ?").bind(session).all();
  const matchedPosters = new Set<string>();
  (openTasks || []).forEach((t: any) => {
    const distFromStart = haversine(from_lat, from_lng, t.lat, t.lng);
    const distFromEnd = haversine(to_lat, to_lng, t.lat, t.lng);
    const pathLength = haversine(from_lat, from_lng, to_lat, to_lng);
    const onSegment = (distFromStart + distFromEnd) < (pathLength + radius * 2);
    const s = (distFromStart + distFromEnd + pathLength) / 2;
    const area = Math.sqrt(Math.max(0, s * (s - distFromStart) * (s - distFromEnd) * (s - pathLength)));
    const offPath = pathLength > 0 ? (2 * area) / pathLength : distFromStart;
    if (onSegment && offPath <= radius && !matchedPosters.has(t.poster_id)) {
      matchedPosters.add(t.poster_id);
      createNotification(db, t.poster_id, 'helper_nearby', 'Helper Passing By!', `${user?.name || 'A helper'} is traveling near your task "${t.title}". They might be able to help!`, `/tasks/${t.id}`);
    }
  });

  return new Response(JSON.stringify({ ok: true, id, matchedTasks: matchedPosters.size }), { status: 201 });
};

// DELETE /api/path - deactivate path
export const DELETE: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const db = (env as any).DB as D1Database;
  await db.prepare("UPDATE paths SET active = 0 WHERE user_id = ?").bind(session).run();
  return new Response(JSON.stringify({ ok: true }));
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
