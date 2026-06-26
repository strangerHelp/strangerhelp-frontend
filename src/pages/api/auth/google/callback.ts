import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../../lib/db';
import { createSession } from '../../../../lib/session';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  if (!code) return redirect('/login?error=google_failed');

  const clientId = (env as any).GOOGLE_CLIENT_ID;
  const clientSecret = (env as any).GOOGLE_CLIENT_SECRET;
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) return redirect('/login?error=google_failed');
  const { access_token } = await tokenRes.json() as any;

  // Get user info
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  if (!userRes.ok) return redirect('/login?error=google_failed');
  const gUser = await userRes.json() as any;

  const db = (env as any).DB as D1Database;
  const email = gUser.email;
  const name = gUser.name || email.split('@')[0];
  const avatar = gUser.picture || '';

  // Check if user exists
  let user: any = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();

  if (!user) {
    // Create new user (no password needed for OAuth users)
    const id = genId();
    await db.prepare(
      "INSERT INTO users (id, name, email, password, avatar) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, name, email, '__google_oauth__', avatar).run();
    user = { id };
  }

  const token = await createSession(user.id);
  cookies.set('session', token, { httpOnly: true, secure: true, path: '/', maxAge: 60 * 60 * 24 * 7, sameSite: 'lax' });

  return redirect('/dashboard');
};
