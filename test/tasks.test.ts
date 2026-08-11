import { describe, it, expect, beforeEach } from 'vitest';
import { env } from './cloudflare-workers';
import { createSession } from '../src/lib/session';

const DB = () => env.DB as any;

const POSTER = 'poster_1';
const CLAIMER = 'claimer_1';
const OUTSIDER = 'outsider_1';
const TASK = 'task_1';

async function seedUser(id: string, over: Record<string, any> = {}) {
  await DB().prepare(
    "INSERT INTO users (id, name, email, password, is_admin, banned) VALUES (?, ?, ?, 'x', ?, ?)"
  ).bind(id, over.name ?? id, over.email ?? `${id}@example.com`, over.is_admin ?? 0, over.banned ?? 0).run();
}

async function seedTask(over: Record<string, any> = {}) {
  await DB().prepare(
    `INSERT INTO tasks (id, title, category, budget, location, poster_id, poster_name, status, claimed_by, max_claimers, completion_proof, completion_status)
     VALUES (?, ?, 'errand', 100, 'Mumbai', ?, 'Poster', ?, ?, ?, ?, ?)`
  ).bind(
    over.id ?? TASK, over.title ?? 'Test task', over.poster_id ?? POSTER,
    over.status ?? 'claimed', over.claimed_by ?? CLAIMER, over.max_claimers ?? 1,
    over.completion_proof ?? '[]', over.completion_status ?? ''
  ).run();
}

/** Build a Request + cookies pair the route handlers accept. */
async function ctx(userId: string | null, body: unknown, taskId = TASK) {
  const token = userId ? await createSession(userId) : null;
  return {
    params: { id: taskId },
    request: new Request(`https://strangerhelp.com/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    cookies: { get: (n: string) => (n === 'session' && token ? { value: token } : undefined) } as any,
    url: new URL(`https://strangerhelp.com/api/tasks/${taskId}`),
  };
}

describe('task completion authorization', () => {
  beforeEach(async () => {
    await seedUser(POSTER);
    await seedUser(CLAIMER);
    await seedUser(OUTSIDER);
  });

  it('rejects unauthenticated callers', async () => {
    await seedTask();
    const { PATCH } = await import('../src/pages/api/tasks/[id]');
    const res = await PATCH((await ctx(null, { action: 'complete' })) as any);
    expect(res.status).toBe(401);
  });

  // Regression: a non-assignee could fire 'complete' and the poster received a
  // spoofed completion notification even though no row was updated.
  it('rejects a user who does not hold the task', async () => {
    await seedTask({ completion_proof: JSON.stringify(['data:image/png;base64,AAA']) });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');
    const res = await PATCH((await ctx(OUTSIDER, { action: 'complete' })) as any);
    expect(res.status).toBe(403);

    const notes = await DB().prepare("SELECT COUNT(*) AS c FROM notifications").first();
    expect(notes.c).toBe(0);
  });

  // Regression: this path set status straight to 'completed', bypassing the
  // proof + poster-approval flow entirely.
  it('refuses to complete without proof', async () => {
    await seedTask({ completion_proof: '[]' });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');
    const res = await PATCH((await ctx(CLAIMER, { action: 'complete' })) as any);
    expect(res.status).toBe(400);

    const task = await DB().prepare("SELECT status FROM tasks WHERE id = ?").bind(TASK).first();
    expect(task.status).toBe('claimed'); // not silently completed
  });

  it('moves to pending review when the claimer has submitted proof', async () => {
    await seedTask({ completion_proof: JSON.stringify(['data:image/png;base64,AAA']) });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');
    const res = await PATCH((await ctx(CLAIMER, { action: 'complete' })) as any);
    expect(res.status).toBe(200);

    const task = await DB().prepare("SELECT status, completion_status FROM tasks WHERE id = ?").bind(TASK).first();
    // Poster still has to accept - the helper cannot self-approve.
    expect(task.completion_status).toBe('pending');
    expect(task.status).not.toBe('completed');
  });

  it('lets only the poster accept completion', async () => {
    await seedTask({ completion_status: 'pending' });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');

    const denied = await PATCH((await ctx(CLAIMER, { action: 'accept_completion' })) as any);
    expect(denied.status).toBe(403);

    const ok = await PATCH((await ctx(POSTER, { action: 'accept_completion' })) as any);
    expect(ok.status).toBe(200);
    const task = await DB().prepare("SELECT status FROM tasks WHERE id = ?").bind(TASK).first();
    expect(task.status).toBe('completed');
  });

  it('blocks a banned user even with a valid token', async () => {
    await seedUser('banned_1', { banned: 1 });
    await seedTask({ claimed_by: 'banned_1', completion_proof: JSON.stringify(['x']) });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');
    const res = await PATCH((await ctx('banned_1', { action: 'complete' })) as any);
    expect(res.status).toBe(401);
  });

  it('validates helper coordinates, accepting 0 and rejecting out-of-range', async () => {
    await seedTask();
    const { PATCH } = await import('../src/pages/api/tasks/[id]');

    // lat 0 is valid and must not be rejected by a falsy check.
    const zero = await PATCH((await ctx(CLAIMER, { action: 'update_location', lat: 0, lng: 0 })) as any);
    expect(zero.status).toBe(200);

    const bad = await PATCH((await ctx(CLAIMER, { action: 'update_location', lat: 999, lng: 0 })) as any);
    expect(bad.status).toBe(400);
  });

  it('lets only the poster edit, and only while open', async () => {
    await seedTask({ status: 'open', claimed_by: null });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');

    const denied = await PATCH((await ctx(OUTSIDER, { action: 'edit', title: 'Hacked' })) as any);
    expect(denied.status).toBe(403);

    const ok = await PATCH((await ctx(POSTER, { action: 'edit', title: 'Updated title' })) as any);
    expect(ok.status).toBe(200);
    const task = await DB().prepare("SELECT title FROM tasks WHERE id = ?").bind(TASK).first();
    expect(task.title).toBe('Updated title');
  });

  it('refuses to claim your own task', async () => {
    await seedTask({ status: 'open', claimed_by: null });
    const { PATCH } = await import('../src/pages/api/tasks/[id]');
    const res = await PATCH((await ctx(POSTER, { action: 'claim' })) as any);
    expect(res.status).toBe(400);
  });
});

describe('task deletion', () => {
  beforeEach(async () => {
    await seedUser(POSTER);
    await seedUser(OUTSIDER);
    await seedUser('admin_1', { is_admin: 1 });
    await seedTask();
  });

  async function del(userId: string) {
    const token = await createSession(userId);
    const { DELETE } = await import('../src/pages/api/tasks/[id]');
    return DELETE({
      params: { id: TASK },
      cookies: { get: (n: string) => (n === 'session' ? { value: token } : undefined) },
    } as any);
  }

  it('denies a non-owner', async () => {
    expect((await del(OUTSIDER)).status).toBe(403);
  });

  it('allows the poster to delete an open task', async () => {
    expect((await del(POSTER)).status).toBe(200);
  });

  it('allows an admin', async () => {
    await seedTask({ id: TASK }); // re-seed after previous test deleted it
    expect((await del('admin_1')).status).toBe(200);
  });

  it('blocks the poster from deleting a claimed task', async () => {
    await DB().prepare("UPDATE tasks SET status = 'claimed', claimed_by = ? WHERE id = ?")
      .bind(CLAIMER, TASK).run();
    const res = await del(POSTER);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/claimed/i);
    // task must still exist
    const row = await DB().prepare("SELECT id FROM tasks WHERE id = ?").bind(TASK).first();
    expect(row).not.toBeNull();
  });

  it('blocks the poster from deleting a completed task', async () => {
    await DB().prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").bind(TASK).run();
    expect((await del(POSTER)).status).toBe(400);
  });

  it('allows an admin to delete a claimed task', async () => {
    await DB().prepare("UPDATE tasks SET status = 'claimed' WHERE id = ?").bind(TASK).run();
    expect((await del('admin_1')).status).toBe(200);
  });
});
