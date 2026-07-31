import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import bcrypt from 'bcryptjs';
import { createSession } from '../../../lib/session';
import { isRateLimited } from '../../../lib/ratelimit';
import { setSessionCookie } from '../../../lib/cookies';

// A real bcrypt hash of a value nobody can supply. Compared against when the
// email is unknown so the response time does not reveal whether an account
// exists (previously we returned immediately, leaking enumeration via timing).
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  try {
    if (await isRateLimited(request, 'login')) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429 });
    }

    const db = (env as any).DB as D1Database;

    // Malformed JSON is a client error, not a server error.
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }
    const rawEmail = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!rawEmail || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
    }
    if (/[\x00-\x1f\x7f]/.test(rawEmail) || /[\x00-\x1f\x7f]/.test(password)) {
      return new Response(JSON.stringify({ error: 'Invalid characters' }), { status: 400 });
    }

    // Normalise so Foo@Bar.com and foo@bar.com resolve to the same account.
    const email = rawEmail.trim().toLowerCase();

    const user: any = await db
      .prepare("SELECT id, name, password, banned FROM users WHERE email = ?")
      .bind(email)
      .first();

    // Always run a bcrypt comparison, even when the user is unknown.
    const valid = await bcrypt.compare(password, user?.password || DUMMY_HASH);

    // OAuth-only accounts have no usable password.
    if (!user || !valid || user.password === '__google_oauth__') {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }

    if (user.banned) {
      return new Response(JSON.stringify({ error: 'Your account has been suspended.' }), { status: 403 });
    }

    const token = await createSession(user.id);
    setSessionCookie(cookies, url, token);
    return new Response(JSON.stringify({ id: user.id, name: user.name }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
