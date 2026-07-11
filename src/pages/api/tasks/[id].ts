import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { createNotification } from '../notifications';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ params }) => {
  const db = (env as any).DB as D1Database;
  const task: any = await db.prepare(
    "SELECT t.*, up.verified as poster_verified, uc.verified as claimer_verified FROM tasks t LEFT JOIN users up ON t.poster_id = up.id LEFT JOIN users uc ON t.claimed_by = uc.id WHERE t.id = ?"
  ).bind(params.id).first();
  if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  // Get claimed users for group tasks only (avoid extra query for normal tasks)
  let claimedUsers: any[] = [];
  if ((task.max_claimers || 1) > 1) {
    const { results } = await db.prepare("SELECT user_id, user_name, claimed_at FROM claimed_users WHERE task_id = ?").bind(params.id).all();
    claimedUsers = results || [];
  }

  return new Response(JSON.stringify({
    ...task, _id: task.id, posterId: task.poster_id, posterName: task.poster_name,
    posterVerified: task.poster_verified === 1,
    claimedBy: task.claimed_by, claimedByName: task.claimed_by_name,
    claimerVerified: task.claimer_verified === 1,
    maxClaimers: task.max_claimers || 1,
    claimedUsers,
    completionProof: JSON.parse(task.completion_proof || '[]'),
    attachments: JSON.parse(task.attachments || '[]'), createdAt: task.created_at,
  }));
};

export const PATCH: APIRoute = async ({ params, request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(session).first();
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const action = formData.get('action') as string;
    const files = formData.getAll('proof') as File[];
    const proofUrls: string[] = [];

    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      if (dataUrl) proofUrls.push(dataUrl);
    }

    if (action === 'complete' && proofUrls.length > 0) {
      const task: any = await db.prepare("SELECT poster_id, title FROM tasks WHERE id = ?").bind(params.id).first();
      await db.prepare("UPDATE tasks SET status = 'completed', completed_at = datetime('now'), completion_proof = ? WHERE id = ? AND claimed_by = ?")
        .bind(JSON.stringify(proofUrls), params.id, session).run();
      if (task) {
        await createNotification(db, task.poster_id, 'task_completed', 'Task Completed', `${user?.name || 'Helper'} completed: ${task.title}`, `/tasks/${params.id}`);
      }
    }
    return new Response(JSON.stringify({ ok: true, proofs: proofUrls }));
  }

  const { action } = await request.json();

  if (action === 'claim') {
    const task: any = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task || task.status === 'completed') return new Response(JSON.stringify({ error: 'Task not available' }), { status: 400 });
    if (task.poster_id === session) return new Response(JSON.stringify({ error: 'Cannot claim your own task' }), { status: 400 });

    const maxClaimers = task.max_claimers || 1;

    if (maxClaimers > 1) {
      // Group/Event task — multiple claimers allowed
      const existing: any = await db.prepare("SELECT id FROM claimed_users WHERE task_id = ? AND user_id = ?").bind(params.id, session).first();
      if (existing) return new Response(JSON.stringify({ error: 'You already claimed this task' }), { status: 400 });

      const count: any = await db.prepare("SELECT COUNT(*) as c FROM claimed_users WHERE task_id = ?").bind(params.id).first();
      if ((count?.c || 0) >= maxClaimers) return new Response(JSON.stringify({ error: 'All slots are filled' }), { status: 400 });

      await db.prepare("INSERT INTO claimed_users (id, task_id, user_id, user_name) VALUES (?, ?, ?, ?)")
        .bind(genId(), params.id, session, user?.name || 'Helper').run();

      // Update task status
      const newCount = (count?.c || 0) + 1;
      if (newCount >= maxClaimers) {
        await db.prepare("UPDATE tasks SET status = 'claimed', claimed_at = datetime('now') WHERE id = ?").bind(params.id).run();
      } else {
        await db.prepare("UPDATE tasks SET status = 'open' WHERE id = ?").bind(params.id).run();
      }

      // Create conversation
      const convExists: any = await db.prepare("SELECT id FROM conversations WHERE task_id = ? AND ((participant_1 = ? AND participant_2 = ?) OR (participant_1 = ? AND participant_2 = ?))").bind(params.id, task.poster_id, session, session, task.poster_id).first();
      if (!convExists) {
        const convId = genId();
        await db.prepare("INSERT INTO conversations (id, task_id, participant_1, participant_2, participant_1_name, participant_2_name, last_message) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(convId, params.id, task.poster_id, session, task.poster_name, user?.name || 'Helper', 'Joined group task — chat started').run();
      }

      await createNotification(db, task.poster_id, 'task_claimed', 'Helper Joined', `${user?.name || 'Someone'} joined: ${task.title} (${newCount}/${maxClaimers})`, `/tasks/${params.id}`);
      return new Response(JSON.stringify({ ok: true, status: newCount >= maxClaimers ? 'claimed' : 'open', claimedCount: newCount, maxClaimers }));
    } else {
      // Single claimer (original behavior)
      if (task.status !== 'open') return new Response(JSON.stringify({ error: 'Task not available' }), { status: 400 });

      await db.prepare("UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_by_name = ?, claimed_at = datetime('now') WHERE id = ? AND status = 'open'")
        .bind(session, user?.name || 'Helper', params.id).run();

      const existing: any = await db.prepare("SELECT id FROM conversations WHERE task_id = ? AND ((participant_1 = ? AND participant_2 = ?) OR (participant_1 = ? AND participant_2 = ?))").bind(params.id, task.poster_id, session, session, task.poster_id).first();
      if (!existing) {
        const convId = genId();
        await db.prepare("INSERT INTO conversations (id, task_id, participant_1, participant_2, participant_1_name, participant_2_name, last_message) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(convId, params.id, task.poster_id, session, task.poster_name, user?.name || 'Helper', 'Task claimed — chat started').run();
      }

      await createNotification(db, task.poster_id, 'task_claimed', 'Task Claimed', `${user?.name || 'Someone'} claimed: ${task.title}`, `/tasks/${params.id}`);
      return new Response(JSON.stringify({ ok: true, status: 'claimed' }));
    }
  }

  if (action === 'complete') {
    const task: any = await db.prepare("SELECT poster_id, title, max_claimers FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    // For group tasks, verify user is a claimer
    if ((task.max_claimers || 1) > 1) {
      const isClaimer: any = await db.prepare("SELECT id FROM claimed_users WHERE task_id = ? AND user_id = ?").bind(params.id, session).first();
      if (!isClaimer) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }
    await db.prepare("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND (claimed_by = ? OR ? IN (SELECT user_id FROM claimed_users WHERE task_id = ?))").bind(params.id, session, session, params.id).run();
    if (task) {
      await createNotification(db, task.poster_id, 'task_completed', 'Task Completed', `${user?.name || 'Helper'} completed: ${task.title}`, `/tasks/${params.id}`);
    }
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'edit') {
    // Only poster can edit, and only if task is still open
    const task: any = await db.prepare("SELECT poster_id, status FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    if (task.poster_id !== session) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    if (task.status !== 'open') return new Response(JSON.stringify({ error: 'Cannot edit a task that has been claimed or completed' }), { status: 400 });

    const body = await request.json() as any;
    const updates: string[] = [];
    const values: any[] = [];

    if (body.title && body.title.length <= 200) { updates.push("title = ?"); values.push(body.title.trim()); }
    if (body.description !== undefined) { updates.push("description = ?"); values.push(body.description); }
    if (body.budget) {
      const b = parseInt(body.budget);
      if (b >= 1 && b <= 500000) { updates.push("budget = ?"); values.push(b); }
    }
    if (body.deadline) { updates.push("deadline = ?"); values.push(body.deadline); }
    if (body.location) { updates.push("location = ?"); values.push(body.location); }
    if (body.category) { updates.push("category = ?"); values.push(body.category); }
    if (body.urgent !== undefined) { updates.push("urgent = ?"); values.push(body.urgent ? 1 : 0); }
    if (body.lat !== undefined) { updates.push("lat = ?"); values.push(body.lat); }
    if (body.lng !== undefined) { updates.push("lng = ?"); values.push(body.lng); }

    if (updates.length === 0) return new Response(JSON.stringify({ error: 'No fields to update' }), { status: 400 });
    values.push(params.id);
    await db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });
};

export const DELETE: APIRoute = async ({ params, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT is_admin FROM users WHERE id = ?").bind(session).first();
  const task: any = await db.prepare("SELECT poster_id FROM tasks WHERE id = ?").bind(params.id).first();
  if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  if (task.poster_id !== session && !user?.is_admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  await db.prepare("DELETE FROM tasks WHERE id = ?").bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }));
};
