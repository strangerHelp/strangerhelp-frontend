import { describe, it, expect } from 'vitest';
import { env } from './cloudflare-workers';

const DB = () => env.DB as any;

/**
 * Cookie jar that mirrors Astro's AstroCookies semantics: outgoing cookies are
 * keyed by name, so a second set/delete for the same name REPLACES the first
 * and only the last one is actually sent as a Set-Cookie header.
 *
 * A naive mock that appends every call hides real bugs - an extra delete that
 * clobbers a domain-scoped one looks fine in an array but breaks logout.
 */
function recordingJar() {
  const outgoing = new Map<string, any>();
  return {
    /** What would actually be emitted as Set-Cookie. */
    emitted: (name: string) => outgoing.get(name),
    get set() { return [...outgoing.values()].filter((c) => c.op === 'set'); },
    get deleted() { return [...outgoing.values()].filter((c) => c.op === 'delete'); },
    cookies: {
      get: () => undefined,
      set: (name: string, value: string, opts: any) => outgoing.set(name, { op: 'set', name, value, opts }),
      delete: (name: string, opts: any) => outgoing.set(name, { op: 'delete', name, opts }),
    } as any,
  };
}

function req(body: unknown) {
  return new Request('https://strangerhelp.com/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.' + Math.floor(Math.random() * 250) },
    body: JSON.stringify(body),
  });
}

const VALID = {
  name: 'Test User',
  email: 'Test.User@Example.COM',
  password: 'correct horse battery',
  city: 'Mumbai',
  address: '12 Main St',
  country: 'India',
};

async function register(body: Record<string, unknown>) {
  const jar = recordingJar();
  const { POST } = await import('../src/pages/api/auth/register');
  const res = await POST({
    request: req(body),
    cookies: jar.cookies,
    url: new URL('https://strangerhelp.com/api/auth/register'),
  } as any);
  return { res, jar };
}

async function login(email: string, password: string) {
  const jar = recordingJar();
  const { POST } = await import('../src/pages/api/auth/login');
  const res = await POST({
    request: new Request('https://strangerhelp.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '198.51.100.' + Math.floor(Math.random() * 250) },
      body: JSON.stringify({ email, password }),
    }),
    cookies: jar.cookies,
    url: new URL('https://strangerhelp.com/api/auth/login'),
  } as any);
  return { res, jar };
}

describe('registration', () => {
  it('creates an account and sets a session cookie', async () => {
    const { res, jar } = await register(VALID);
    expect(res.status).toBe(201);
    expect(jar.set).toHaveLength(1);
    expect(jar.set[0].name).toBe('session');
    expect(jar.set[0].opts.httpOnly).toBe(true);
    expect(jar.set[0].opts.sameSite).toBe('lax');
    // Production host must scope the cookie so logout can clear it.
    expect(jar.set[0].opts.domain).toBe('.strangerhelp.com');
  });

  // Regression: email was stored with original casing, so Foo@x.com and
  // foo@x.com produced two accounts and login became case-sensitive.
  it('stores the email lowercased', async () => {
    await register(VALID);
    const row = await DB().prepare("SELECT email FROM users").first();
    expect(row.email).toBe('test.user@example.com');
  });

  it('rejects a duplicate email that differs only by case', async () => {
    expect((await register(VALID)).res.status).toBe(201);
    const dup = await register({ ...VALID, email: 'TEST.USER@example.com' });
    expect(dup.res.status).toBe(409);
    expect((await DB().prepare("SELECT COUNT(*) AS c FROM users").first()).c).toBe(1);
  });

  // Regression: `country` was bound into the `bio` column, so every new user's
  // bio was silently set to their country.
  it('stores country in country and leaves bio empty', async () => {
    await register(VALID);
    const row = await DB().prepare("SELECT country, bio, area, city FROM users").first();
    expect(row.country).toBe('India');
    expect(row.bio).toBe('');
    expect(row.area).toBe('12 Main St');
    expect(row.city).toBe('Mumbai');
  });

  it('never stores the password in plaintext', async () => {
    await register(VALID);
    const row = await DB().prepare("SELECT password FROM users").first();
    expect(row.password).not.toBe(VALID.password);
    expect(row.password.startsWith('$2')).toBe(true);
  });

  it('rejects a short password', async () => {
    const { res } = await register({ ...VALID, password: 'short' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed email', async () => {
    const { res } = await register({ ...VALID, email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  it('rejects control characters', async () => {
    const { res } = await register({ ...VALID, name: 'Bad\x00Name' });
    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const { res } = await register({ email: 'a@b.com', password: 'longenough1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 (not 500) for a malformed JSON body', async () => {
    const jar = recordingJar();
    const { POST } = await import('../src/pages/api/auth/register');
    const res = await POST({
      request: new Request('https://strangerhelp.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.9' },
        body: 'not json at all',
      }),
      cookies: jar.cookies,
      url: new URL('https://strangerhelp.com/api/auth/register'),
    } as any);
    expect(res.status).toBe(400);
  });
});

describe('login', () => {
  it('accepts the correct password regardless of email casing', async () => {
    await register(VALID);
    const { res, jar } = await login('TEST.user@EXAMPLE.com', VALID.password);
    expect(res.status).toBe(200);
    expect(jar.set[0].name).toBe('session');
  });

  it('rejects a wrong password', async () => {
    await register(VALID);
    const { res } = await login(VALID.email, 'wrong password');
    expect(res.status).toBe(401);
  });

  it('returns the same error for unknown and wrong-password accounts', async () => {
    await register(VALID);
    const unknown = await login('nobody@example.com', 'whatever');
    const wrong = await login(VALID.email, 'wrong password');
    expect(unknown.res.status).toBe(401);
    expect(wrong.res.status).toBe(401);
    // Identical body, so the response cannot be used to enumerate accounts.
    expect(await unknown.res.json()).toEqual(await wrong.res.json());
  });

  it('rejects a banned user', async () => {
    await register(VALID);
    await DB().prepare("UPDATE users SET banned = 1").run();
    const { res } = await login(VALID.email, VALID.password);
    expect(res.status).toBe(403);
  });

  // An OAuth-only account stores a sentinel instead of a hash and must not be
  // loginable by supplying that sentinel as the password.
  it('rejects password login for an OAuth-only account', async () => {
    await DB().prepare(
      "INSERT INTO users (id, name, email, password) VALUES ('g1', 'G', 'g@example.com', '__google_oauth__')"
    ).run();
    const { res } = await login('g@example.com', '__google_oauth__');
    expect(res.status).toBe(401);
  });
});

describe('logout', () => {
  async function logout(host: string) {
    const jar = recordingJar();
    const { POST } = await import('../src/pages/api/auth/logout');
    await POST({
      cookies: jar.cookies,
      url: new URL(`${host}/api/auth/logout`),
      redirect: (to: string) => new Response(null, { status: 302, headers: { Location: to } }),
    } as any);
    return jar;
  }

  // Regression: the cookie was set with domain=.strangerhelp.com but deleted
  // without it, so the browser kept the session and logout did nothing.
  // The assertion checks the cookie that is ACTUALLY emitted, because a later
  // delete for the same name silently replaces an earlier one.
  it('emits a deletion carrying the production domain', async () => {
    const jar = await logout('https://strangerhelp.com');
    const emitted = jar.emitted('session');
    expect(emitted).toBeDefined();
    expect(emitted.op).toBe('delete');
    expect(emitted.opts.domain).toBe('.strangerhelp.com');
    expect(emitted.opts.path).toBe('/');
  });

  it('emits exactly one session cookie instruction', async () => {
    const jar = await logout('https://strangerhelp.com');
    // More than one delete for the same name means only the last survives,
    // which is how the domain-scoped deletion previously got dropped.
    expect(jar.deleted).toHaveLength(1);
  });

  it('uses a host-only cookie on localhost', async () => {
    const jar = await logout('http://localhost:4321');
    expect(jar.emitted('session').opts.domain).toBeUndefined();
  });
});
