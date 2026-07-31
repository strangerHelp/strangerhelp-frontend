import { describe, it, expect, beforeEach } from 'vitest';
import { env } from './cloudflare-workers';
import { createSession } from '../src/lib/session';
import { isRateLimited } from '../src/lib/ratelimit';

const DB = () => env.DB as any;

async function seedUser(id: string, over: Record<string, any> = {}) {
  await DB().prepare(
    "INSERT INTO users (id, name, email, password, is_admin, banned) VALUES (?, ?, ?, 'x', ?, ?)"
  ).bind(id, id, `${id}@example.com`, over.is_admin ?? 0, over.banned ?? 0).run();
}

function jar(token: string | null) {
  return { get: (n: string) => (n === 'session' && token ? { value: token } : undefined) } as any;
}

function jsonReq(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('question voting', () => {
  const Q = 'q_1';

  beforeEach(async () => {
    await seedUser('voter_1');
    await seedUser('voter_2');
    await DB().prepare(
      "INSERT INTO questions (id, text, category, location, poster_id, votes) VALUES (?, 'Is it open?', 'general', 'Delhi', 'voter_1', 0)"
    ).bind(Q).run();
  });

  async function vote(userId: string, dir: string) {
    const token = await createSession(userId);
    const { POST } = await import('../src/pages/api/questions/[id]');
    return POST({
      params: { id: Q },
      request: jsonReq(`https://strangerhelp.com/api/questions/${Q}`, { action: 'vote', vote: dir }),
      cookies: jar(token),
    } as any);
  }

  async function votes() {
    const row = await DB().prepare("SELECT votes FROM questions WHERE id = ?").bind(Q).first();
    return row.votes;
  }

  // Regression: the endpoint applied an unbounded increment per call, so a
  // single account could drive a question's score arbitrarily.
  it('counts only one vote no matter how many times it is called', async () => {
    for (let i = 0; i < 10; i++) await vote('voter_1', 'up');
    expect(await votes()).toBe(1);
  });

  it('counts distinct users separately', async () => {
    await vote('voter_1', 'up');
    await vote('voter_2', 'up');
    expect(await votes()).toBe(2);
  });

  it('allows switching direction without double counting', async () => {
    await vote('voter_1', 'up');
    expect(await votes()).toBe(1);
    await vote('voter_1', 'down');
    expect(await votes()).toBe(-1);
  });

  it('rejects an invalid vote direction', async () => {
    const res = await vote('voter_1', 'sideways');
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const { POST } = await import('../src/pages/api/questions/[id]');
    const res = await POST({
      params: { id: Q },
      request: jsonReq(`https://strangerhelp.com/api/questions/${Q}`, { action: 'vote', vote: 'up' }),
      cookies: jar(null),
    } as any);
    expect(res.status).toBe(401);
  });

  it('rejects empty and oversized answers', async () => {
    const token = await createSession('voter_1');
    const { POST } = await import('../src/pages/api/questions/[id]');

    const empty = await POST({
      params: { id: Q },
      request: jsonReq(`https://strangerhelp.com/api/questions/${Q}`, { action: 'answer', text: '   ' }),
      cookies: jar(token),
    } as any);
    expect(empty.status).toBe(400);

    const huge = await POST({
      params: { id: Q },
      request: jsonReq(`https://strangerhelp.com/api/questions/${Q}`, { action: 'answer', text: 'a'.repeat(5001) }),
      cookies: jar(token),
    } as any);
    expect(huge.status).toBe(400);

    expect((await DB().prepare("SELECT COUNT(*) AS c FROM answers").first()).c).toBe(0);
  });
});

describe('report validation', () => {
  beforeEach(async () => { await seedUser('reporter_1'); });

  async function report(body: unknown) {
    const token = await createSession('reporter_1');
    const { POST } = await import('../src/pages/api/reports');
    return POST({
      request: jsonReq('https://strangerhelp.com/api/reports', body),
      cookies: jar(token),
    } as any);
  }

  it('rejects an oversized description', async () => {
    const res = await report({ type: 'user', reason: 'spam', description: 'x'.repeat(5001) });
    expect(res.status).toBe(400);
  });

  // 'verification' reports carry ID documents and must only be created by
  // /api/auth/verify, never forged through the public report endpoint.
  it('refuses to let a user forge a verification report', async () => {
    const res = await report({ type: 'verification', reason: 'ID: fake' });
    expect(res.status).toBe(400);
    expect((await DB().prepare("SELECT COUNT(*) AS c FROM reports").first()).c).toBe(0);
  });

  it('accepts a valid report', async () => {
    const res = await report({ type: 'user', reason: 'Harassment', description: 'details' });
    expect(res.status).toBe(201);
  });
});

describe('rate limiting', () => {
  function req(ip: string | null) {
    const headers: Record<string, string> = {};
    if (ip) headers['cf-connecting-ip'] = ip;
    return new Request('https://strangerhelp.com/api/auth/login', { method: 'POST', headers });
  }

  it('blocks after the attempt threshold', async () => {
    const r = req('1.2.3.4');
    const results: boolean[] = [];
    for (let i = 0; i < 12; i++) results.push(await isRateLimited(r, 'login'));
    expect(results[0]).toBe(false);
    expect(results[11]).toBe(true);
  });

  it('tracks each IP independently', async () => {
    for (let i = 0; i < 12; i++) await isRateLimited(req('5.5.5.5'), 'login');
    expect(await isRateLimited(req('6.6.6.6'), 'login')).toBe(false);
  });

  it('tracks each action independently', async () => {
    for (let i = 0; i < 12; i++) await isRateLimited(req('7.7.7.7'), 'login');
    expect(await isRateLimited(req('7.7.7.7'), 'register')).toBe(false);
  });

  // Regression: x-forwarded-for is client-controlled and was accepted as a
  // fallback, so rotating it bypassed the limiter entirely.
  it('ignores a spoofed x-forwarded-for header', async () => {
    const spoofed = new Request('https://strangerhelp.com/api/auth/login', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '9.9.9.9' },
    });
    for (let i = 0; i < 12; i++) await isRateLimited(spoofed, 'login');

    const rotated = new Request('https://strangerhelp.com/api/auth/login', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '8.8.8.8', 'x-forwarded-for': '10.10.10.10' },
    });
    // Same real IP, different spoofed header -> still limited.
    expect(await isRateLimited(rotated, 'login')).toBe(true);
  });
});

describe('conversation access control', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedUser('eve');
    await DB().prepare(
      "INSERT INTO conversations (id, participant_1, participant_2, participant_1_name, participant_2_name) VALUES ('conv_1', 'alice', 'bob', 'alice', 'bob')"
    ).run();
    await DB().prepare(
      "INSERT INTO messages (id, conversation_id, sender_id, sender_name, text) VALUES ('m1', 'conv_1', 'alice', 'alice', 'private')"
    ).run();
  });

  async function read(userId: string | null) {
    const token = userId ? await createSession(userId) : null;
    const { GET } = await import('../src/pages/api/messages/[conversationId]');
    return GET({ params: { conversationId: 'conv_1' }, cookies: jar(token) } as any);
  }

  it('lets a participant read the thread', async () => {
    const res = await read('alice');
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });

  it('hides the thread from a non-participant', async () => {
    expect((await read('eve')).status).toBe(404);
  });

  it('requires authentication', async () => {
    expect((await read(null)).status).toBe(401);
  });
});

describe('admin support replies', () => {
  beforeEach(async () => {
    await seedUser('admin_2', { is_admin: 1 });
    await seedUser('carol');
    await seedUser('dave');
    await DB().prepare(
      "INSERT INTO conversations (id, participant_1, participant_2) VALUES ('sup_1', 'carol', 'support')"
    ).run();
    await DB().prepare(
      "INSERT INTO conversations (id, participant_1, participant_2) VALUES ('dm_1', 'carol', 'dave')"
    ).run();
  });

  async function reply(userId: string, conversationId: string) {
    const token = await createSession(userId);
    const { POST } = await import('../src/pages/api/admin/support');
    return POST({
      request: jsonReq('https://strangerhelp.com/api/admin/support', { conversationId, text: 'hello' }),
      cookies: jar(token),
    } as any);
  }

  it('denies non-admins', async () => {
    expect((await reply('carol', 'sup_1')).status).toBe(403);
  });

  it('allows an admin to reply to a support thread', async () => {
    expect((await reply('admin_2', 'sup_1')).status).toBe(200);
  });

  // Regression: any conversation id was accepted, letting a 'Support Team'
  // message be injected into a private user-to-user thread.
  it('refuses to inject a support message into a private thread', async () => {
    const res = await reply('admin_2', 'dm_1');
    expect(res.status).toBe(404);
    const msgs = await DB().prepare("SELECT COUNT(*) AS c FROM messages WHERE conversation_id = 'dm_1'").first();
    expect(msgs.c).toBe(0);
  });
});
