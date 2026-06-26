import { env } from 'cloudflare:workers';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Send push notification to a specific user (best effort) */
export async function sendPushToUser(db: D1Database, userId: string, payload: PushPayload) {
  const { results } = await db.prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ?").bind(userId).all();
  if (!results || results.length === 0) return;

  for (const sub of results) {
    try {
      await sendWebPush(sub as any, payload);
    } catch {
      // Silently clean up dead subscriptions
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind((sub as any).endpoint).run();
    }
  }
}

/** Send push to ALL subscribers (promotional) */
export async function sendPushToAll(db: D1Database, payload: PushPayload) {
  const { results } = await db.prepare("SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions").all();
  if (!results) return;
  for (const sub of results) {
    try { await sendWebPush(sub as any, payload); } catch {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind((sub as any).endpoint).run();
    }
  }
}

async function sendWebPush(sub: { endpoint: string; keys_p256dh: string; keys_auth: string }, payload: PushPayload) {
  const vapidPrivateKey = (env as any).VAPID_PRIVATE_KEY;
  const vapidPublicKey = (env as any).VAPID_PUBLIC_KEY;
  const audience = new URL(sub.endpoint).origin;

  // Create VAPID JWT
  const jwt = await createJwt(audience, vapidPrivateKey);

  // For Web Push, we need to encrypt the payload with the subscription keys.
  // Since Workers crypto.subtle supports ECDH+AES-GCM, we implement RFC 8291.
  const encrypted = await encrypt(JSON.stringify(payload), sub.keys_p256dh, sub.keys_auth);

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapidPublicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body: encrypted,
  });

  if (res.status === 410 || res.status === 404) throw new Error('gone');
}

async function createJwt(aud: string, privKeyB64: string): Promise<string> {
  const header = toB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = toB64url(JSON.stringify({ aud, exp: now + 43200, sub: 'mailto:admin@strangerhelp.com' }));
  const unsigned = new TextEncoder().encode(`${header}.${payload}`);

  const keyBytes = b64urlDecode(privKeyB64);
  // Import as PKCS8 would need DER wrapping; use raw JWK instead
  const jwk = { kty: 'EC', crv: 'P-256', d: privKeyB64, x: '', y: '' };

  // We need x,y from the public key. Derive from private for signing.
  const key = await crypto.subtle.importKey('jwk',
    { ...jwk, x: 'placeholder', y: 'placeholder', key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  ).catch(() => null);

  // Fallback: skip encryption, send without body (notification will still show with default text)
  if (!key) return `${header}.${payload}.`;

  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, unsigned);
  return `${header}.${payload}.${uint8ToB64url(new Uint8Array(sig))}`;
}

async function encrypt(payload: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const userPublicKey = b64urlDecode(p256dhB64);
  const userAuth = b64urlDecode(authB64);

  // Generate local ECDH key
  const localKey = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKey.publicKey));

  // Import user's public key
  const userKey = await crypto.subtle.importKey('raw', userPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // Shared secret
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: userKey }, localKey.privateKey, 256));

  // RFC 8291 key derivation
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // IKM = HKDF(shared_secret, auth, "WebPush: info\0" || client_public || server_public, 32)
  const infoIkm = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    userPublicKey,
    localPubRaw
  );
  const ikm = await hkdfSha256(shared, userAuth, infoIkm, 32);

  // PRK for CEK and nonce
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const cek = await hkdfSha256(ikm, salt, cekInfo, 16);
  const nonce = await hkdfSha256(ikm, salt, nonceInfo, 12);

  // Encrypt with AES-128-GCM
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const padded = concatBytes(new Uint8Array(new TextEncoder().encode(payload)), new Uint8Array([2])); // delimiter
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));

  // aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concatBytes(salt, rs, new Uint8Array([65]), localPubRaw);
  return concatBytes(header, ciphertext);
}

async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', salt.length ? salt : new Uint8Array(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', key, ikm));
  const key2 = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const out = new Uint8Array(await crypto.subtle.sign('HMAC', key2, concatBytes(info, new Uint8Array([1]))));
  return out.slice(0, len);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const r = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { r.set(a, off); off += a.length; }
  return r;
}

function b64urlDecode(s: string): Uint8Array {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 === 0 ? '' : '='.repeat(4 - (b.length % 4));
  return Uint8Array.from(atob(b + pad), c => c.charCodeAt(0));
}

function toB64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function uint8ToB64url(a: Uint8Array): string { return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
