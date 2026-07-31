import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../../../lib/db';
import { createSession } from '../../../../lib/session';
import { setSessionCookie } from '../../../../lib/cookies';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = cookies.get('oauth_state')?.value;

  if (!code || !state || state !== expectedState) return redirect('/login?error=google_failed');
  cookies.delete('oauth_state', { path: '/' });

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

  if (!gUser?.email) return redirect('/login?error=google_failed');

  // Google tells us whether it has actually verified ownership of this address.
  // Without this check, an account whose email Google has not verified could be
  // used to sign straight into an existing password account with the same email.
  if (gUser.verified_email !== true && gUser.email_verified !== true) {
    return redirect('/login?error=google_unverified');
  }

  const db = (env as any).DB as D1Database;
  const email = String(gUser.email).trim().toLowerCase();
  const name = gUser.name || email.split('@')[0];
  const avatar = gUser.picture || '';

  // Check if user exists
  let user: any = await db.prepare("SELECT id, password FROM users WHERE email = ?").bind(email).first();

  if (!user) {
    // New OAuth user. Google verified the address, so trust it.
    const id = genId();
    await db.prepare(
      "INSERT INTO users (id, name, email, password, avatar, email_verified) VALUES (?, ?, ?, ?, ?, 1)"
    ).bind(id, name, email, '__google_oauth__', avatar).run();
    user = { id };
  } else if (user.password !== '__google_oauth__') {
    // An existing password account owns this email. Silently signing in here
    // would hand over the account, so require the password instead.
    return redirect('/login?error=use_password');
  }

  const token = await createSession(user.id);
  setSessionCookie(cookies, url, token);

  return redirect('/dashboard');
};
