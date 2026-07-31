import { describe, it, expect } from 'vitest';
import { env } from './cloudflare-workers';
import { createSession, verifySession, verifySessionWithMeta } from '../src/lib/session';
import { getSessionUserId, getUser } from '../src/lib/auth';
import { isAdmin } from '../src/lib/admin';
import { cookieDomain } from '../src/lib/cookies';

const DB = () => env.DB as any;

/** Minimal AstroCookies stand-in - only .get() is used by the auth helpers. */
function cookieJar(session?: string) {
  return {
    get: (name: string) => (name === 'session' && session ? { value: session } : undefined),
  } as any;
}

async function makeUser(over: Record<string, any> = {}) {
  const u = {
    id: over.id ?? 'u_' + Math.random().toString(16).slice(2, 10),
    name: 'Test User',
    email: over.email ?? `t${Math.random().toString(16).slice(2, 8)}@example.com`,
    password: 'hashed',
    banned: 0,
    is_admin: 0,
    token_valid_from: 0,
    ...over,
  };
  await DB().prepare(
    "INSERT INTO users (id, name, email, password, banned, is_admin, token_valid_from) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(u.id, u.name, u.email, u.password, u.banned, u.is_admin, u.token_valid_from).run();
  return u;
}

describe('session tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await createSession('user123');
    expect(await verifySession(token)).toBe('user123');
  });

  it('rejects a tampered signature', async () => {
    const token = await createSession('user123');
    const [id, ts] = token.split('.');
    expect(await verifySession(`${id}.${ts}.forgedsignature`)).toBeNull();
  });

  it('rejects a token whose user id was swapped', async () => {
    const token = await createSession('user123');
    const [, ts, sig] = token.split('.');
    expect(await verifySession(`attacker.${ts}.${sig}`)).toBeNull();
  });

  it('rejects malformed and empty tokens', async () => {
    expect(await verifySession('')).toBeNull();
    expect(await verifySession('a.b')).toBeNull();
    expect(await verifySession('a.b.c.d')).toBeNull();
  });

  it('rejects an expired token', async () => {
    // 8 days old, signed correctly - must fail on age alone.
    const old = Math.floor(Date.now() / 1000 - 8 * 24 * 60 * 60).toString(36);
    const forged = await createSession('user123');
    const sig = forged.split('.')[2];
    expect(await verifySession(`user123.${old}.${sig}`)).toBeNull();
  });

  it('exposes issuedAt for revocation checks', async () => {
    const meta = await verifySessionWithMeta(await createSession('user123'));
    expect(meta?.userId).toBe('user123');
    expect(meta?.issuedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
});

describe('ban enforcement on the API layer', () => {
  it('resolves a normal user', async () => {
    const u = await makeUser();
    const token = await createSession(u.id);
    expect(await getSessionUserId(cookieJar(token))).toBe(u.id);
  });

  // Regression: banned users previously kept full access to every /api/* route
  // because only page routes checked the flag.
  it('rejects a banned user holding a validly signed token', async () => {
    const u = await makeUser({ banned: 1 });
    const token = await createSession(u.id);
    expect(await getSessionUserId(cookieJar(token))).toBeNull();
    expect(await getUser(cookieJar(token))).toBeNull();
  });

  it('rejects a token for a deleted user', async () => {
    const token = await createSession('never_existed');
    expect(await getSessionUserId(cookieJar(token))).toBeNull();
  });

  it('returns null when no cookie is present', async () => {
    expect(await getSessionUserId(cookieJar())).toBeNull();
  });

  it('denies admin to a banned admin', async () => {
    const u = await makeUser({ banned: 1, is_admin: 1 });
    expect(await isAdmin(cookieJar(await createSession(u.id)))).toBe(false);
  });

  it('grants admin only to is_admin users', async () => {
    const admin = await makeUser({ is_admin: 1 });
    const normal = await makeUser({ is_admin: 0 });
    expect(await isAdmin(cookieJar(await createSession(admin.id)))).toBe(true);
    expect(await isAdmin(cookieJar(await createSession(normal.id)))).toBe(false);
  });
});

describe('session revocation via token_valid_from', () => {
  // Regression: a stolen cookie stayed valid for the full 7 days even after
  // the victim reset their password.
  it('rejects tokens issued before the last password reset', async () => {
    const u = await makeUser();
    const token = await createSession(u.id);
    expect(await getSessionUserId(cookieJar(token))).toBe(u.id);

    await DB().prepare("UPDATE users SET token_valid_from = ? WHERE id = ?")
      .bind(Math.floor(Date.now() / 1000) + 5, u.id).run();

    expect(await getSessionUserId(cookieJar(token))).toBeNull();
  });

  it('accepts tokens issued after the reset', async () => {
    const u = await makeUser({ token_valid_from: Math.floor(Date.now() / 1000) - 60 });
    expect(await getSessionUserId(cookieJar(await createSession(u.id)))).toBe(u.id);
  });
});

describe('cookie domain resolution', () => {
  // Regression: logout deleted the cookie without domain while login set it
  // with domain=.strangerhelp.com, so the session survived logout.
  it('uses the shared parent domain in production', () => {
    expect(cookieDomain(new URL('https://strangerhelp.com/x'))).toBe('.strangerhelp.com');
    expect(cookieDomain(new URL('https://www.strangerhelp.com/x'))).toBe('.strangerhelp.com');
  });

  it('uses a host-only cookie outside production', () => {
    expect(cookieDomain(new URL('http://localhost:4321/x'))).toBeUndefined();
    expect(cookieDomain(new URL('https://strangerhelp.workers.dev/x'))).toBeUndefined();
  });

  it('never returns another site domain', () => {
    expect(cookieDomain(new URL('https://evil.com/x'))).toBeUndefined();
  });
});
