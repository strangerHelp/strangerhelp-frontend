import { env } from 'cloudflare:workers';

const SEPARATOR = '.';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret(): string {
  const secret = (env as any).SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not configured');
  return secret;
}

async function hmacSign(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacVerify(data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(data);
  return expected === signature;
}

/** Create a signed session token: userId.timestamp.signature */
export async function createSession(userId: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString(36);
  const payload = `${userId}${SEPARATOR}${timestamp}`;
  const sig = await hmacSign(payload);
  return `${payload}${SEPARATOR}${sig}`;
}

/** Verify and extract userId from signed token. Returns null if invalid/expired. */
export async function verifySession(token: string): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) return null;

  const [userId, timestamp, sig] = parts;
  const payload = `${userId}${SEPARATOR}${timestamp}`;

  if (!(await hmacVerify(payload, sig))) return null;

  const created = parseInt(timestamp, 36);
  const now = Math.floor(Date.now() / 1000);
  if (now - created > SESSION_MAX_AGE) return null;

  return userId;
}
