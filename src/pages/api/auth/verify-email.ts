import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { verifyEmailToken, sendVerificationEmail } from '../../../lib/email';
import { getSessionUserId } from '../../../lib/auth';

// GET /api/auth/verify-email?token=xxx - verify email from link
export const GET: APIRoute = async ({ url, redirect }) => {
  const token = url.searchParams.get('token');
  if (!token) return redirect('/verify-email?error=missing');

  const db = (env as any).DB as D1Database;
  const result = await verifyEmailToken(db, token, 'verify');

  if (!result) return redirect('/verify-email?error=invalid');

  await db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").bind(result.userId).run();
  return redirect('/verify-email?success=true');
};

// POST /api/auth/verify-email - resend verification email
export const POST: APIRoute = async ({ cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const db = (env as any).DB as D1Database;
  const user: any = await db.prepare("SELECT id, email, email_verified FROM users WHERE id = ?").bind(session).first();

  if (!user) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  if (user.email_verified) return new Response(JSON.stringify({ ok: true, message: 'Email already verified' }));

  await sendVerificationEmail(db, user.id, user.email);
  return new Response(JSON.stringify({ ok: true, message: 'Verification email sent' }));
};
