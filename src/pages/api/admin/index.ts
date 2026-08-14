import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { isAdmin } from '../../../lib/admin';

export const GET: APIRoute = async ({ cookies, url }) => {
  const db = (env as any).DB as D1Database;
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const resource = url.searchParams.get('resource');

  if (resource === 'stats') {
    const users = await db.prepare("SELECT COUNT(*) as c FROM users").first();
    const tasks = await db.prepare("SELECT COUNT(*) as c FROM tasks").first();
    const messages = await db.prepare("SELECT COUNT(*) as c FROM messages").first();
    const conversations = await db.prepare("SELECT COUNT(*) as c FROM conversations").first();
    const openTasks = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'open'").first();
    const claimedTasks = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'claimed'").first();
    const completedTasks = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'").first();
    const meets = await db.prepare("SELECT COUNT(*) as c FROM meets").first();
    const reports = await db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'open'").first();
    const activePaths = await db.prepare("SELECT COUNT(*) as c FROM paths WHERE active = 1").first();
    const claimRequests = await db.prepare("SELECT COUNT(*) as c FROM claim_requests WHERE status = 'pending'").first();
    const verifiedUsers = await db.prepare("SELECT COUNT(*) as c FROM users WHERE verified = 1").first();
    const todayUsers = await db.prepare("SELECT COUNT(*) as c FROM users WHERE created_at > datetime('now', '-1 day')").first();
    const todayTasks = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE created_at > datetime('now', '-1 day')").first();
    const weekTasks = await db.prepare("SELECT COUNT(*) as c FROM tasks WHERE created_at > datetime('now', '-7 days')").first();
    const avgBudget = await db.prepare("SELECT AVG(budget) as avg FROM tasks WHERE budget > 0").first();
    const totalBudget = await db.prepare("SELECT SUM(budget) as total FROM tasks WHERE status = 'completed'").first();

    return new Response(JSON.stringify({
      users: (users as any)?.c, tasks: (tasks as any)?.c, messages: (messages as any)?.c,
      conversations: (conversations as any)?.c, openTasks: (openTasks as any)?.c,
      claimedTasks: (claimedTasks as any)?.c, completedTasks: (completedTasks as any)?.c,
      meets: (meets as any)?.c, openReports: (reports as any)?.c,
      activePaths: (activePaths as any)?.c, pendingClaims: (claimRequests as any)?.c,
      verifiedUsers: (verifiedUsers as any)?.c, todayUsers: (todayUsers as any)?.c,
      todayTasks: (todayTasks as any)?.c, weekTasks: (weekTasks as any)?.c,
      avgBudget: Math.round((avgBudget as any)?.avg || 0),
      totalGMV: (totalBudget as any)?.total || 0,
    }));
  }

  if (resource === 'users') {
    const { results } = await db.prepare("SELECT id, name, email, city, is_admin, banned, created_at FROM users ORDER BY created_at DESC LIMIT 50").all();
    const users = (results || []).map((u: any) => ({ ...u, _id: u.id, isAdmin: u.is_admin, createdAt: u.created_at }));
    return new Response(JSON.stringify(users));
  }

  if (resource === 'tasks') {
    const { results } = await db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 50").all();
    const tasks = (results || []).map((t: any) => ({ ...t, _id: t.id, posterId: t.poster_id, posterName: t.poster_name, createdAt: t.created_at }));
    return new Response(JSON.stringify(tasks));
  }

  return new Response(JSON.stringify({ error: 'Invalid resource' }), { status: 400 });
};

export const PATCH: APIRoute = async ({ cookies, request }) => {
  const db = (env as any).DB as D1Database;
  if (!(await isAdmin(cookies))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });

  const { action, id } = await request.json();
  if (action === 'ban_user') await db.prepare("UPDATE users SET banned = 1 WHERE id = ?").bind(id).run();
  else if (action === 'unban_user') await db.prepare("UPDATE users SET banned = 0 WHERE id = ?").bind(id).run();
  else if (action === 'make_admin') await db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").bind(id).run();
  else if (action === 'delete_task') await db.prepare("DELETE FROM tasks WHERE id = ?").bind(id).run();
  else if (action === 'verify_user') await db.prepare("UPDATE users SET verified = 1, verification_status = 'approved' WHERE id = ?").bind(id).run();
  else if (action === 'reject_verification') await db.prepare("UPDATE users SET verification_status = '' WHERE id = ?").bind(id).run();
  else if (action === 'delete_user') {
    try {
      // Order matters: D1 enforces foreign keys, and the constraints are
      // immediate (checked per statement), not deferred. Three FKs apply here:
      //   tasks.poster_id        -> users.id
      //   messages.conversation_id -> conversations.id
      //   answers.question_id    -> questions.id
      //
      // So a child must be cleared by RELATIONSHIP, not just by author. Deleting
      // only this user's messages and then their conversations left the OTHER
      // participant's messages pointing at a deleted conversation, which is what
      // raised SQLITE_CONSTRAINT_FOREIGNKEY. Same shape for answers/questions.
      await db.batch([
        // 1. Messages: clear every message in any conversation the user is part
        //    of (including the other participant's and 'support' messages),
        //    then any stray messages they sent elsewhere. Only then can the
        //    conversations themselves go.
        db.prepare(
          "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE participant_1 = ? OR participant_2 = ?)"
        ).bind(id, id),
        db.prepare("DELETE FROM messages WHERE sender_id = ?").bind(id),
        db.prepare("DELETE FROM conversations WHERE participant_1 = ? OR participant_2 = ?").bind(id, id),

        // 2. Q&A: clear all answers and votes on the user's questions (authored
        //    by anyone), plus the user's own answers/votes on other questions,
        //    before removing the questions.
        db.prepare(
          "DELETE FROM answers WHERE question_id IN (SELECT id FROM questions WHERE poster_id = ?)"
        ).bind(id),
        db.prepare("DELETE FROM answers WHERE author_id = ?").bind(id),
        db.prepare(
          "DELETE FROM question_votes WHERE question_id IN (SELECT id FROM questions WHERE poster_id = ?)"
        ).bind(id),
        db.prepare("DELETE FROM question_votes WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM questions WHERE poster_id = ?").bind(id),

        // 3. Task-related rows. No FK on task_id, but clearing them avoids
        //    dangling references to tasks that are about to be deleted.
        db.prepare(
          "DELETE FROM claimed_users WHERE user_id = ? OR task_id IN (SELECT id FROM tasks WHERE poster_id = ?)"
        ).bind(id, id),
        db.prepare(
          "DELETE FROM claim_requests WHERE requester_id = ? OR task_id IN (SELECT id FROM tasks WHERE poster_id = ?)"
        ).bind(id, id),
        db.prepare(
          "DELETE FROM reviews WHERE reviewer_id = ? OR reviewee_id = ? OR task_id IN (SELECT id FROM tasks WHERE poster_id = ?)"
        ).bind(id, id, id),

        // 4. Release tasks this user had claimed back to the pool rather than
        //    leaving claimed_by pointing at a deleted account.
        db.prepare(
          "UPDATE tasks SET status = 'open', claimed_by = NULL, claimed_by_name = NULL, claimed_at = NULL, completion_status = '', completion_proof = '[]', tracking_active = 0, helper_lat = NULL, helper_lng = NULL WHERE claimed_by = ?"
        ).bind(id),

        // 5. Remaining user-owned rows, then the tasks they posted (satisfying
        //    tasks.poster_id -> users.id), then the account itself.
        db.prepare("DELETE FROM meet_attendees WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM push_subscriptions WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM email_tokens WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM paths WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM notifications WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM pulse WHERE user_id = ?").bind(id),
        db.prepare("DELETE FROM reports WHERE reporter_id = ?").bind(id),
        db.prepare("DELETE FROM tasks WHERE poster_id = ?").bind(id),
        db.prepare("DELETE FROM users WHERE id = ?").bind(id),
      ]);
    } catch (e: any) {
      return new Response(JSON.stringify({ error: 'Delete failed: ' + (e?.message || 'unknown error') }), { status: 500 });
    }
  }
  else return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });

  return new Response(JSON.stringify({ ok: true }));
};
