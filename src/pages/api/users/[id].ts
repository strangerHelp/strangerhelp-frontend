import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

// GET /api/users/[id] - public user profile with trust stats
export const GET: APIRoute = async ({ params }) => {
  const db = (env as any).DB as D1Database;
  const id = params.id;

  // Try lookup by handle first, then by ID
  let user: any = await db.prepare("SELECT id, name, handle, avatar, city, bio, verified, rating, trust_score, tasks_completed, tasks_posted, created_at FROM users WHERE handle = ? OR id = ?").bind(id, id).first();
  if (!user) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  // Calculate real stats from tasks table
  const posted: any = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE poster_id = ?").bind(user.id).first();
  const completed: any = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE (poster_id = ? OR claimed_by = ?) AND status = 'completed'").bind(user.id, user.id).first();
  const claimed: any = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE claimed_by = ?").bind(user.id).first();
  const reviews: any = await db.prepare("SELECT COUNT(*) as cnt, AVG(rating) as avg FROM reviews WHERE reviewee_id = ?").bind(user.id).first();

  const totalInvolved = (posted?.c || 0) + (claimed?.c || 0);
  const completionRate = totalInvolved > 0 ? Math.round(((completed?.c || 0) / totalInvolved) * 100) : 0;

  return new Response(JSON.stringify({
    id: user.id,
    name: user.name,
    handle: user.handle,
    avatar: user.avatar,
    city: user.city,
    bio: user.bio,
    verified: user.verified === 1,
    rating: Math.round((reviews?.avg || user.rating || 0) * 10) / 10,
    totalReviews: reviews?.cnt || 0,
    tasksPosted: posted?.c || 0,
    tasksClaimed: claimed?.c || 0,
    tasksCompleted: completed?.c || 0,
    completionRate,
    trustScore: user.trust_score || 0,
    memberSince: user.created_at,
  }));
};
