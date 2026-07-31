import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import bcrypt from 'bcryptjs';
import { createSession } from '../../../lib/session';
import { isRateLimited } from '../../../lib/ratelimit';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    if (await isRateLimited(request, 'login')) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429 });
    }

    const db = (env as any).DB as D1Database;
    const { email, password } = await request.json();

    if (!email || !password) {
      return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
    }
    if (/[\x00-\x1f\x7f]/.test(email) || /[\x00-\x1f\x7f]/.test(password)) {
      return new Response(JSON.stringify({ error: 'Invalid characters' }), { status: 400 });
    }

    const user: any = await db.prepare("SELECT id, name, password, banned FROM users WHERE email = ?").bind(email).first();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }

    if (user.banned) {
      return new Response(JSON.stringify({ error: 'Your account has been suspended.' }), { status: 403 });
    }

    const token = await createSession(user.id);
    cookies.set('session', token, { httpOnly: true, secure: true, path: '/', maxAge: 60 * 60 * 24 * 7, sameSite: 'lax', domain: '.strangerhelp.com' });
    return new Response(JSON.stringify({ id: user.id, name: user.name }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
