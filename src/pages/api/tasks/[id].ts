import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId, fileToDataUrl } from '../../../lib/db';
import { createNotification } from '../notifications';
import { getSessionUserId } from '../../../lib/auth';

export const GET: APIRoute = async ({ params, url, cookies }) => {
  const db = (env as any).DB as D1Database;
  const task: any = await db.prepare(
    "SELECT t.*, up.verified as poster_verified, uc.verified as claimer_verified FROM tasks t LEFT JOIN users up ON t.poster_id = up.id LEFT JOIN users uc ON t.claimed_by = uc.id WHERE t.id = ?"
  ).bind(params.id).first();
  if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  // Access control for private tasks:
  // Allowed if: task is public, user is poster, user is claimer, or valid invite code provided
  if (task.visibility === 'private') {
    const session = await getSessionUserId(cookies);
    const inviteParam = url.searchParams.get('invite');
    const isOwner = session && task.poster_id === session;
    const isClaimer = session && task.claimed_by === session;
    const hasValidInvite = inviteParam && task.invite_code && inviteParam === task.invite_code;

    // Also check group task claimers
    let isGroupClaimer = false;
    if (session && !isOwner && !isClaimer && (task.max_claimers || 1) > 1) {
      const cu: any = await db.prepare("SELECT id FROM claimed_users WHERE task_id = ? AND user_id = ?").bind(params.id, session).first();
      isGroupClaimer = !!cu;
    }

    if (!isOwner && !isClaimer && !isGroupClaimer && !hasValidInvite) {
      return new Response(JSON.stringify({ error: 'This is a private task. You need an invite link to access it.' }), { status: 403 });
    }
  }

  // Get claimed users for group tasks only (avoid extra query for normal tasks)
  let claimedUsers: any[] = [];
  if ((task.max_claimers || 1) > 1) {
    const { results } = await db.prepare("SELECT user_id, user_name, claimed_at FROM claimed_users WHERE task_id = ?").bind(params.id).all();
    claimedUsers = results || [];
  }

  // Get pending claim requests
  const { results: claimRequests } = await db.prepare("SELECT id, requester_id, requester_name, status, offered_budget, message, created_at FROM claim_requests WHERE task_id = ? ORDER BY created_at DESC").bind(params.id).all();

  return new Response(JSON.stringify({
    ...task, _id: task.id, posterId: task.poster_id, posterName: task.poster_name,
    posterVerified: task.poster_verified === 1,
    claimedBy: task.claimed_by, claimedByName: task.claimed_by_name,
    claimerVerified: task.claimer_verified === 1,
    maxClaimers: task.max_claimers || 1,
    claimedUsers,
    claimRequests: claimRequests || [],
    trackingActive: task.tracking_active === 1,
    helperLat: task.helper_lat,
    helperLng: task.helper_lng,
    completionProof: JSON.parse(task.completion_proof || '[]'),
    attachments: JSON.parse(task.attachments || '[]'), createdAt: task.created_at,
    visibility: task.visibility || 'public',
    inviteCode: task.invite_code || null,
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
      const task: any = await db.prepare("SELECT poster_id, title, claimed_by, max_claimers FROM tasks WHERE id = ?").bind(params.id).first();
      if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

      // Confirm the caller holds the task before writing proof or notifying,
      // so a non-assignee cannot spoof a "proof submitted" alert to the poster.
      let isAssignee = task.claimed_by === session;
      if (!isAssignee && (task.max_claimers || 1) > 1) {
        const isClaimer: any = await db.prepare("SELECT id FROM claimed_users WHERE task_id = ? AND user_id = ?").bind(params.id, session).first();
        isAssignee = !!isClaimer;
      }
      if (!isAssignee) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

      await db.prepare("UPDATE tasks SET completion_status = 'pending', completion_proof = ? WHERE id = ?")
        .bind(JSON.stringify(proofUrls), params.id).run();
      await createNotification(db, task.poster_id, 'completion_pending', 'Proof Submitted', `${user?.name || 'Helper'} submitted completion proof for: ${task.title}. Please review and approve.`, `/tasks/${params.id}`);
    }
    return new Response(JSON.stringify({ ok: true, proofs: proofUrls }));
  }

  const body = await request.json() as any;
  const { action, requesterId } = body;

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
      // Single claimer — request-based flow
      if (task.status !== 'open') return new Response(JSON.stringify({ error: 'Task not available' }), { status: 400 });

      // Check if already requested
      const existingReq: any = await db.prepare("SELECT id, status FROM claim_requests WHERE task_id = ? AND requester_id = ?").bind(params.id, session).first();
      if (existingReq) {
        if (existingReq.status === 'approved') return new Response(JSON.stringify({ error: 'Already approved' }), { status: 400 });
        return new Response(JSON.stringify({ error: 'Request already sent' }), { status: 409 });
      }

      // Create claim request
      const reqId = genId();
      await db.prepare("INSERT INTO claim_requests (id, task_id, requester_id, requester_name, offered_budget, message) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(reqId, params.id, session, user?.name || 'Helper', body.offered_budget || null, body.message || '').run();

      // Create conversation so they can discuss
      const existing: any = await db.prepare("SELECT id FROM conversations WHERE task_id = ? AND ((participant_1 = ? AND participant_2 = ?) OR (participant_1 = ? AND participant_2 = ?))").bind(params.id, task.poster_id, session, session, task.poster_id).first();
      let convId = existing?.id;
      if (!existing) {
        convId = genId();
        await db.prepare("INSERT INTO conversations (id, task_id, participant_1, participant_2, participant_1_name, participant_2_name, last_message) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .bind(convId, params.id, task.poster_id, session, task.poster_name, user?.name || 'Helper', 'Claim request sent — discuss details').run();
      }

      // Notify poster
      const budgetNote = body.offered_budget ? ` (asking ₹${body.offered_budget})` : '';
      await createNotification(db, task.poster_id, 'claim_request', 'Claim Request', `${user?.name || 'Someone'} wants to claim: ${task.title}${budgetNote}`, `/tasks/${params.id}`);
      return new Response(JSON.stringify({ ok: true, status: 'requested', conversationId: convId }));
    }
  }

  if (action === 'approve_claim') {
    const task: any = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    if (task.poster_id !== session) return new Response(JSON.stringify({ error: 'Only poster can approve' }), { status: 403 });
    if (task.status !== 'open') return new Response(JSON.stringify({ error: 'Task already claimed' }), { status: 400 });
    if (!requesterId) return new Response(JSON.stringify({ error: 'requesterId required' }), { status: 400 });

    await db.prepare("UPDATE claim_requests SET status = 'approved' WHERE task_id = ? AND requester_id = ?").bind(params.id, requesterId).run();
    await db.prepare("UPDATE claim_requests SET status = 'rejected' WHERE task_id = ? AND requester_id != ? AND status = 'pending'").bind(params.id, requesterId).run();

    const requester: any = await db.prepare("SELECT name FROM users WHERE id = ?").bind(requesterId).first();
    await db.prepare("UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_by_name = ?, claimed_at = datetime('now') WHERE id = ?")
      .bind(requesterId, requester?.name || 'Helper', params.id).run();

    await createNotification(db, requesterId, 'claim_approved', 'Claim Approved!', `Your claim for "${task.title}" was approved!`, `/tasks/${params.id}`);
    return new Response(JSON.stringify({ ok: true, status: 'claimed' }));
  }

  if (action === 'reject_claim') {
    const task: any = await db.prepare("SELECT poster_id, title FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task || task.poster_id !== session) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    if (!requesterId) return new Response(JSON.stringify({ error: 'requesterId required' }), { status: 400 });

    await db.prepare("UPDATE claim_requests SET status = 'rejected' WHERE task_id = ? AND requester_id = ?").bind(params.id, requesterId).run();
    await createNotification(db, requesterId, 'claim_rejected', 'Claim Rejected', `Your claim for "${task.title}" was not approved.`, `/tasks/${params.id}`);
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'complete') {
    const task: any = await db.prepare("SELECT poster_id, title, max_claimers, claimed_by, completion_proof FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

    // Verify the caller actually holds this task. Previously only group tasks
    // were checked, and the notification fired regardless of whether the
    // UPDATE matched, letting anyone spam "task completed" alerts to a poster.
    let isAssignee = task.claimed_by === session;
    if (!isAssignee && (task.max_claimers || 1) > 1) {
      const isClaimer: any = await db.prepare("SELECT id FROM claimed_users WHERE task_id = ? AND user_id = ?").bind(params.id, session).first();
      isAssignee = !!isClaimer;
    }
    if (!isAssignee) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

    // Completion requires proof the poster can review. This path used to set
    // status straight to 'completed', skipping the proof + approval flow that
    // the multipart upload path enforces.
    let proofs: unknown[] = [];
    try { proofs = JSON.parse(task.completion_proof || '[]'); } catch { proofs = []; }
    if (!Array.isArray(proofs) || proofs.length === 0) {
      return new Response(JSON.stringify({ error: 'Submit completion proof before marking this task complete.' }), { status: 400 });
    }

    await db.prepare("UPDATE tasks SET completion_status = 'pending' WHERE id = ?").bind(params.id).run();
    await createNotification(db, task.poster_id, 'completion_pending', 'Proof Submitted', `${user?.name || 'Helper'} marked "${task.title}" complete. Please review and approve.`, `/tasks/${params.id}`);
    return new Response(JSON.stringify({ ok: true, status: 'pending' }));
  }

  if (action === 'start_tracking') {
    const task: any = await db.prepare("SELECT claimed_by FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task || task.claimed_by !== session) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    await db.prepare("UPDATE tasks SET tracking_active = 1 WHERE id = ?").bind(params.id).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'update_location') {
    const task: any = await db.prepare("SELECT claimed_by FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task || task.claimed_by !== session) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    const lat = Number(body.lat); const lng = Number(body.lng);
    // `!lat` rejected the valid coordinate 0 and accepted out-of-range values.
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return new Response(JSON.stringify({ error: 'Valid lat/lng required' }), { status: 400 });
    }
    await db.prepare("UPDATE tasks SET helper_lat = ?, helper_lng = ? WHERE id = ?").bind(lat, lng, params.id).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'stop_tracking') {
    const task: any = await db.prepare("SELECT claimed_by, poster_id, title FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task || task.claimed_by !== session) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    await db.prepare("UPDATE tasks SET tracking_active = 0, helper_lat = NULL, helper_lng = NULL WHERE id = ?").bind(params.id).run();
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'accept_completion') {
    const task: any = await db.prepare("SELECT poster_id, title, claimed_by FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    if (task.poster_id !== session) return new Response(JSON.stringify({ error: 'Only poster can accept' }), { status: 403 });
    await db.prepare("UPDATE tasks SET status = 'completed', completion_status = 'accepted', completed_at = datetime('now') WHERE id = ?").bind(params.id).run();
    if (task.claimed_by) {
      await createNotification(db, task.claimed_by, 'completion_accepted', 'Task Accepted! ✓', `Your work on "${task.title}" was accepted by the poster.`, `/tasks/${params.id}`);
    }
    return new Response(JSON.stringify({ ok: true, status: 'completed' }));
  }

  if (action === 'reject_completion') {
    const task: any = await db.prepare("SELECT poster_id, title, claimed_by FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    if (task.poster_id !== session) return new Response(JSON.stringify({ error: 'Only poster can reject' }), { status: 403 });
    const reason = body.reason || 'No reason provided';
    await db.prepare("UPDATE tasks SET completion_status = 'rejected', rejection_reason = ?, completion_proof = '[]' WHERE id = ?").bind(reason, params.id).run();
    if (task.claimed_by) {
      await createNotification(db, task.claimed_by, 'completion_rejected', 'Proof Rejected', `Your proof for "${task.title}" was rejected. Reason: ${reason}`, `/tasks/${params.id}`);
    }
    return new Response(JSON.stringify({ ok: true }));
  }

  if (action === 'edit') {
    // Only poster can edit, and only if task is still open
    const task: any = await db.prepare("SELECT poster_id, status FROM tasks WHERE id = ?").bind(params.id).first();
    if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    if (task.poster_id !== session) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    if (task.status !== 'open') return new Response(JSON.stringify({ error: 'Cannot edit a task that has been claimed or completed' }), { status: 400 });

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
  const task: any = await db.prepare("SELECT poster_id, status FROM tasks WHERE id = ?").bind(params.id).first();
  if (!task) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  if (task.poster_id !== session && !user?.is_admin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  // Posters cannot delete once someone has claimed — the claimer has a
  // legitimate interest in the task. Only an admin can remove it at that point.
  if (task.status !== 'open' && !user?.is_admin) {
    return new Response(JSON.stringify({ error: 'Cannot delete a task that has been claimed or completed. Contact support if needed.' }), { status: 400 });
  }
  await db.prepare("DELETE FROM tasks WHERE id = ?").bind(params.id).run();
  return new Response(JSON.stringify({ ok: true }));
};
