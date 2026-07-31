import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import bcrypt from 'bcryptjs';
import { verifyEmailToken } from '../../../lib/email';
import { isRateLimited } from '../../../lib/ratelimit';

// POST /api/auth/reset - verify token and set new password
export const POST: APIRoute = async ({ request }) => {
  if (await isRateLimited(request, 'reset')) {
    return new Response(JSON.stringify({ error: 'Too many attempts. Try again later.' }), { status: 429 });
  }
  const { token, password } = await request.json();
  if (!token || !password) return new Response(JSON.stringify({ error: 'Token and password required' }), { status: 400 });
  if (password.length < 8) return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400 });

  const db = (env as any).DB as D1Database;
  const result = await verifyEmailToken(db, token, 'reset');

  if (!result) {
    return new Response(JSON.stringify({ error: 'Invalid or expired reset link. Please request a new one.' }), { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 10);

  // Revoke every session issued before this moment. Session tokens are
  // stateless HMACs, so without this an attacker holding a stolen cookie
  // keeps access for the full 7-day window even after the victim resets.
  const now = Math.floor(Date.now() / 1000);
  await db.prepare("UPDATE users SET password = ?, token_valid_from = ? WHERE id = ?")
    .bind(hashed, now, result.userId).run();

  return new Response(JSON.stringify({ ok: true, message: 'Password reset successfully. You can now log in.' }));
};
