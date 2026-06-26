import { env } from 'cloudflare:workers';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Send push notification to a specific user */
export async function sendPushToUser(db: D1Database, userId: string, payload: PushPayload) {
  const { results } = await db.prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?").bind(userId).all();
  if (!results || results.length === 0) return;

  for (const sub of results) {
    try {
      await sendPush((sub as any).endpoint, payload);
    } catch {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind((sub as any).endpoint).run();
    }
  }
}

/** Send push to ALL subscribers (promotional) */
export async function sendPushToAll(db: D1Database, payload: PushPayload) {
  const { results } = await db.prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions").all();
  if (!results) return;
  for (const sub of results) {
    try { await sendPush((sub as any).endpoint, payload); } catch {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind((sub as any).endpoint).run();
    }
  }
}

async function sendPush(endpoint: string, payload: PushPayload) {
  const vapidPrivateKey = (env as any).VAPID_PRIVATE_KEY;
  const vapidPublicKey = (env as any).VAPID_PUBLIC_KEY;
  const audience = new URL(endpoint).origin;

  const jwt = await createVapidToken(audience, vapidPrivateKey, vapidPublicKey);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      'Content-Length': '0',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body: null,
  });

  if (res.status === 410 || res.status === 404) throw new Error('gone');
  if (res.status === 403 || res.status === 401) throw new Error('auth failed: ' + res.status);
}

async function createVapidToken(audience: string, privateKeyB64url: string, publicKeyB64url: string): Promise<string> {
  // Build JWT header and claims
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: audience, exp: now + 43200, sub: 'mailto:admin@strangerhelp.com' };

  const headerB64 = toB64url(JSON.stringify(header));
  const claimsB64 = toB64url(JSON.stringify(claims));
  const unsigned = `${headerB64}.${claimsB64}`;

  // Import the private key as JWK for ECDSA signing
  const privateKeyBytes = b64urlDecode(privateKeyB64url);
  const publicKeyBytes = b64urlDecode(publicKeyB64url);

  // The public key is 65 bytes (uncompressed point: 0x04 + 32 bytes x + 32 bytes y)
  const x = uint8ToB64url(publicKeyBytes.slice(1, 33));
  const y = uint8ToB64url(publicKeyBytes.slice(33, 65));
  const d = privateKeyB64url;

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  // Convert signature from DER to raw r||s format (already raw from WebCrypto)
  return `${unsigned}.${uint8ToB64url(new Uint8Array(signature))}`;
}

function b64urlDecode(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4));
  return Uint8Array.from(atob(b + pad), c => c.charCodeAt(0));
}

function toB64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uint8ToB64url(a: Uint8Array): string {
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
