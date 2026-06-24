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

export async function fileToDataUrl(file: File): Promise<string> {
  if (!file || file.size === 0) return '';
  if (file.size > 5 * 1024 * 1024) return ''; // 5MB limit
  const buffer = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return `data:${file.type || 'application/octet-stream'};base64,${base64}`;
}
