import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { createSession } from '../../../lib/session';
import { isRateLimited } from '../../../lib/ratelimit';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    if (await isRateLimited(request, 'register')) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429 });
    }

    const db = (env as any).DB as D1Database;
    const { name, email, password, city, address, country } = await request.json();

    if (!name || !email || !password || !city) {
      return new Response(JSON.stringify({ error: 'All fields required' }), { status: 400 });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400 });
    }

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
      return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409 });
    }

    const id = genId();
    const hashed = await bcrypt.hash(password, 10);

    await db.prepare("INSERT INTO users (id, name, email, password, city, area, bio) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, name, email, hashed, city, address || '', country || '').run();

    const token = await createSession(id);
    cookies.set('session', token, { httpOnly: true, secure: true, path: '/', maxAge: 60 * 60 * 24 * 7, sameSite: 'lax' });

    // Send verification email (non-blocking)
    try {
      const { sendVerificationEmail } = await import('../../../lib/email');
      await sendVerificationEmail(db, id, email);
    } catch {}

    return new Response(JSON.stringify({ id, name }), { status: 201 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
