import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { createNotification } from './notifications';

// GET - get reviews for a user or task
export const GET: APIRoute = async ({ url }) => {
  const db = (env as any).DB as D1Database;
  const userId = url.searchParams.get('userId');
  const taskId = url.searchParams.get('taskId');

  let results: any[];
  if (taskId) {
    ({ results } = await db.prepare("SELECT * FROM reviews WHERE task_id = ? ORDER BY created_at DESC").bind(taskId).all() as any);
  } else if (userId) {
    ({ results } = await db.prepare("SELECT * FROM reviews WHERE reviewee_id = ? ORDER BY created_at DESC LIMIT 20").bind(userId).all() as any);
  } else {
    return new Response(JSON.stringify({ error: 'userId or taskId required' }), { status: 400 });
  }

  // Calculate average rating
  const reviews = results || [];
  const avgRating = reviews.length > 0 ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length : 0;

  return new Response(JSON.stringify({ reviews, avgRating: Math.round(avgRating * 10) / 10, totalReviews: reviews.length }));
};

// POST - submit a review
export const POST: APIRoute = async ({ request, cookies }) => {
  const { getSessionUserId } = await import('../../lib/auth');
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const { taskId, revieweeId, rating, comment } = await request.json();

  if (!taskId || !revieweeId || !rating || rating < 1 || rating > 5) {
    return new Response(JSON.stringify({ error: 'taskId, revieweeId, and rating (1-5) required' }), { status: 400 });
  }

  // Verify the task is completed and user is involved
  const task: any = await db.prepare("SELECT * FROM tasks WHERE id = ? AND status = 'completed'").bind(taskId).first();
  if (!task) return new Response(JSON.stringify({ error: 'Task not found or not completed' }), { status: 400 });

  const isInvolved = task.poster_id === session || task.claimed_by === session;
  if (!isInvolved) return new Response(JSON.stringify({ error: 'You are not part of this task' }), { status: 403 });

  // Validate revieweeId is the other participant
  const validReviewee = (task.poster_id === session && revieweeId === task.claimed_by) || (task.claimed_by === session && revieweeId === task.poster_id);
  if (!validReviewee) return new Response(JSON.stringify({ error: 'Invalid reviewee' }), { status: 403 });

  // Check if already reviewed
  const existing: any = await db.prepare("SELECT id FROM reviews WHERE task_id = ? AND reviewer_id = ?").bind(taskId, session).first();
  if (existing) return new Response(JSON.stringify({ error: 'Already reviewed' }), { status: 409 });

  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
  const id = genId();

  await db.prepare("INSERT INTO reviews (id, task_id, reviewer_id, reviewer_name, reviewee_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, taskId, session, user?.name || 'User', revieweeId, rating, comment || '').run();

  // Update reviewee's average rating
  const { results: allReviews } = await db.prepare("SELECT rating FROM reviews WHERE reviewee_id = ?").bind(revieweeId).all() as any;
  const avg = (allReviews || []).reduce((s: number, r: any) => s + r.rating, 0) / (allReviews?.length || 1);
  await db.prepare("UPDATE users SET rating = ? WHERE id = ?").bind(Math.round(avg * 10) / 10, revieweeId).run();

  // Notify the reviewee
  await createNotification(db, revieweeId, 'review', 'New Review', `${user?.name || 'Someone'} rated you ${rating}/5`, `/tasks/${taskId}`);

  return new Response(JSON.stringify({ ok: true }), { status: 201 });
};
