import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { createSession } from '../../../lib/session';
import { isRateLimited } from '../../../lib/ratelimit';
import { setSessionCookie } from '../../../lib/cookies';

export const POST: APIRoute = async ({ request, cookies, url }) => {
  try {
    if (await isRateLimited(request, 'register')) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429 });
    }

    const db = (env as any).DB as D1Database;

    // Malformed JSON is a client error, not a server error.
    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
    }
    const { name, email: rawEmail, password, city, address, country } = payload ?? {};

    if (!name || !rawEmail || !password || !city) {
      return new Response(JSON.stringify({ error: 'All fields required' }), { status: 400 });
    }
    if (typeof rawEmail !== 'string' || typeof name !== 'string' || typeof password !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid input' }), { status: 400 });
    }
    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400 });
    }
    if (password.length > 200) {
      return new Response(JSON.stringify({ error: 'Password too long' }), { status: 400 });
    }
    if (name.length > 100) return new Response(JSON.stringify({ error: 'Name too long' }), { status: 400 });
    // Reject control characters, null bytes, and non-printable chars
    if (/[\x00-\x1f\x7f]/.test(rawEmail) || /[\x00-\x1f\x7f]/.test(name)) {
      return new Response(JSON.stringify({ error: 'Invalid characters detected' }), { status: 400 });
    }

    // Normalise so casing cannot create duplicate accounts.
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return new Response(JSON.stringify({ error: 'Invalid email format' }), { status: 400 });
    if (email.length > 254) return new Response(JSON.stringify({ error: 'Email too long' }), { status: 400 });

    // Cap the free-text location fields so they cannot be used for bulk storage.
    const cityVal = String(city).slice(0, 100);
    const areaVal = String(address || '').slice(0, 200);
    const countryVal = String(country || '').slice(0, 100);

    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) {
      return new Response(JSON.stringify({ error: 'Email already registered' }), { status: 409 });
    }

    const id = genId();
    const hashed = await bcrypt.hash(password, 10);

    // `country` previously got bound into the `bio` column, so every new user
    // had their country stored as their bio. Each value now lands in its own column.
    await db.prepare(
      "INSERT INTO users (id, name, email, password, city, area, country) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, name, email, hashed, cityVal, areaVal, countryVal).run();

    const token = await createSession(id);
    setSessionCookie(cookies, url, token);

    // Send verification email (best effort - must not block registration)
    try {
      const { sendVerificationEmail } = await import('../../../lib/email');
      await sendVerificationEmail(db, id, email);
    } catch {}

    return new Response(JSON.stringify({ id, name }), { status: 201 });
  } catch {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
