import { env } from 'cloudflare:workers';

export function getDB(): D1Database {
  return (env as any).DB;
}

export function genId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Safe base64 encoding for large files (avoids stack overflow with btoa)
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as any);
  }
  return btoa(binary);
}

/**
 * MIME types we are willing to embed in a data: URL.
 *
 * `file.type` comes from the uploaded part's Content-Type header and is fully
 * attacker-controlled. Interpolating it unchecked allowed a value such as
 *   image/png" onerror="...
 * to close the src attribute of `<img src="${avatar}">` and execute script -
 * a stored XSS that fired for anyone viewing the victim's profile.
 */
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/heic',
  'application/pdf',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'video/webm',
  'video/mp4',
]);

const FALLBACK_MIME = 'application/octet-stream';

/** Normalise an upload's declared MIME type to a known-safe literal. */
export function safeMimeType(raw: string | undefined | null): string {
  if (!raw) return FALLBACK_MIME;
  // Drop any parameters (e.g. "; charset=") and normalise case/space.
  const base = raw.split(';')[0].trim().toLowerCase();
  return ALLOWED_MIME.has(base) ? base : FALLBACK_MIME;
}

export async function fileToDataUrl(file: File): Promise<string> {
  if (!file || file.size === 0) return '';
  if (file.size > 10 * 1024 * 1024) return ''; // 10MB hard limit
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  // safeMimeType guarantees the prefix cannot contain quotes, angle brackets
  // or whitespace, so the result is safe to place in an HTML attribute.
  return `data:${safeMimeType(file.type)};base64,${base64}`;
}
