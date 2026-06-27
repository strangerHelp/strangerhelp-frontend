import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = async ({ redirect, url, cookies }) => {
  const clientId = (env as any).GOOGLE_CLIENT_ID;
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const scope = 'openid email profile';
  const state = crypto.randomUUID();

  // Store state in cookie for CSRF verification
  cookies.set('oauth_state', state, { httpOnly: true, secure: true, path: '/', maxAge: 600, sameSite: 'lax' });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
