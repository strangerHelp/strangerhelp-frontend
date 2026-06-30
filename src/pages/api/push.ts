import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { genId } from '../../lib/db';
import { getSessionUserId } from '../../lib/auth';

// GET - return VAPID public key
export const GET: APIRoute = async () => {
  const publicKey = (env as any).VAPID_PUBLIC_KEY;
  return new Response(JSON.stringify({ publicKey }));
};

// POST - save push subscription
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { endpoint, keys } = await request.json();
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return new Response(JSON.stringify({ error: 'Invalid subscription' }), { status: 400 });
  }

  // Validate endpoint is a legitimate push service URL (prevent SSRF)
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return new Response(JSON.stringify({ error: 'Invalid endpoint: must be HTTPS' }), { status: 400 });
    const allowedHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'wns.windows.com', 'web.push.apple.com'];
    if (!allowedHosts.some(h => url.hostname.endsWith(h))) {
      return new Response(JSON.stringify({ error: 'Invalid push service endpoint' }), { status: 400 });
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid endpoint URL' }), { status: 400 });
  }

  const db = (env as any).DB as D1Database;

  // Upsert: delete old subscription for this endpoint, insert new
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(endpoint).run();
  await db.prepare(
    "INSERT INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?, ?)"
  ).bind(genId(), session, endpoint, keys.p256dh, keys.auth).run();

  return new Response(JSON.stringify({ ok: true }));
};

// DELETE - remove push subscription
export const DELETE: APIRoute = async ({ request, cookies }) => {
  const session = await getSessionUserId(cookies);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });

  const { endpoint } = await request.json();
  const db = (env as any).DB as D1Database;
  await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").bind(endpoint, session).run();
  return new Response(JSON.stringify({ ok: true }));
};
