import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { createNotification } from '../notifications';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ params }) => {
  const db = (env as any).DB as D1Database;
  const task: any = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(params.id).first();
  if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  // Get verified status for poster and claimer
  const poster: any = task.poster_id ? await db.prepare("SELECT verified FROM users WHERE id = ?").bind(task.poster_id).first() : null;
  const claimer: any = task.claimed_by ? await db.prepare("SELECT verified FROM users WHERE id = ?").bind(task.claimed_by).first() : null;

  return new Response(JSON.stringify({
    ...task, _id: task.id, posterId: task.poster_id, posterName: task.poster_name,
    posterVerified: poster?.verified === 1,
    claimedBy: task.claimed_by, claimedByName: task.claimed_by_name,
    claimerVerified: claimer?.verified === 1,
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
    if (!task || task.status !== 'open') return new Response(JSON.stringify({ error: 'Task not available' }), { status: 400 });
    if (task.poster_id === session) return new Response(JSON.stringify({ error: 'Cannot claim your own task' }), { status: 400 });

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

  if (action === 'complete') {
    const task: any = await db.prepare("SELECT poster_id, title FROM tasks WHERE id = ?").bind(params.id).first();
    await db.prepare("UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ? AND claimed_by = ?").bind(params.id, session).run();
    if (task) {
      await createNotification(db, task.poster_id, 'task_completed', 'Task Completed', `${user?.name || 'Helper'} completed: ${task.title}`, `/tasks/${params.id}`);
    }
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
