/**
 * Shared HTML escaping for values interpolated into innerHTML.
 *
 * The client-side rendering in this app builds markup with template literals,
 * so every interpolated value must be escaped or it becomes an XSS vector.
 * Only 3 of 21 pages previously had a local (and inconsistent) escape helper.
 *
 * Exposed on `window` by public/escape.js for use in inline page scripts.
 */

/** Escape text for use in element content or a double-quoted attribute. */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validate a URL that will be placed in src/href.
 *
 * Blocks javascript:, vbscript: and other script-bearing schemes, and rejects
 * data: URLs that are not a plain base64 media payload. Returns '' when the
 * value is not safe so the caller renders no URL at all.
 */
export function safeUrl(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  // Reject anything containing characters that could break out of an attribute
  // or smuggle a handler, regardless of scheme.
  if (/["'<>\s]/.test(raw)) return '';

  const lower = raw.toLowerCase();

  // data: URLs are used for avatars and attachments. Allow only a strict
  // "data:<type>/<subtype>;base64,<payload>" shape.
  if (lower.startsWith('data:')) {
    return /^data:(image|audio|video|application)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(raw) ? raw : '';
  }

  if (lower.startsWith('http://') || lower.startsWith('https://')) return raw;
  // Site-relative paths.
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;

  return '';
}
