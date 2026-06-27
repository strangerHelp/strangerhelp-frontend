import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import bcrypt from 'bcryptjs';
import { verifyEmailToken } from '../../../lib/email';

// POST /api/auth/reset - verify token and set new password
export const POST: APIRoute = async ({ request }) => {
  const { token, password } = await request.json();
  if (!token || !password) return new Response(JSON.stringify({ error: 'Token and password required' }), { status: 400 });
  if (password.length < 8) return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), { status: 400 });

  const db = (env as any).DB as D1Database;
  const result = await verifyEmailToken(db, token, 'reset');

  if (!result) {
    return new Response(JSON.stringify({ error: 'Invalid or expired reset link. Please request a new one.' }), { status: 400 });
  }

  const hashed = await bcrypt.hash(password, 10);
  await db.prepare("UPDATE users SET password = ? WHERE id = ?").bind(hashed, result.userId).run();

  return new Response(JSON.stringify({ ok: true, message: 'Password reset successfully. You can now log in.' }));
};
