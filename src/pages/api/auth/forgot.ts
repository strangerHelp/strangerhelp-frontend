import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { sendResetEmail } from '../../../lib/email';
import { isRateLimited } from '../../../lib/ratelimit';

// POST /api/auth/forgot - request password reset
export const POST: APIRoute = async ({ request }) => {
  if (await isRateLimited(request, 'forgot')) {
    return new Response(JSON.stringify({ error: 'Too many requests. Try again later.' }), { status: 429 });
  }

  const { email } = await request.json();
  if (!email) return new Response(JSON.stringify({ error: 'Email required' }), { status: 400 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT id, email, password FROM users WHERE email = ?").bind(email).first();

  // Always return success (don't reveal if email exists)
  if (!user || user.password === '__google_oauth__') {
    return new Response(JSON.stringify({ ok: true, message: 'If this email is registered, you will receive a reset link.' }));
  }

  await sendResetEmail(db, user.id, user.email);
  return new Response(JSON.stringify({ ok: true, message: 'If this email is registered, you will receive a reset link.' }));
};
