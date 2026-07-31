import { describe, it, expect } from 'vitest';
import { safeMimeType, fileToDataUrl } from '../src/lib/db';
import { escapeHtml, safeUrl } from '../src/lib/html';

describe('safeMimeType', () => {
  it('passes through known media types', () => {
    expect(safeMimeType('image/png')).toBe('image/png');
    expect(safeMimeType('application/pdf')).toBe('application/pdf');
    expect(safeMimeType('audio/webm')).toBe('audio/webm');
  });

  it('normalises case and strips parameters', () => {
    expect(safeMimeType('IMAGE/PNG')).toBe('image/png');
    expect(safeMimeType('image/png; charset=utf-8')).toBe('image/png');
    expect(safeMimeType('  image/jpeg  ')).toBe('image/jpeg');
  });

  it('falls back for unknown types', () => {
    expect(safeMimeType('text/html')).toBe('application/octet-stream');
    expect(safeMimeType('')).toBe('application/octet-stream');
    expect(safeMimeType(undefined)).toBe('application/octet-stream');
  });

  // This is the exact payload that produced a stored XSS: the upload's
  // Content-Type was interpolated into `data:${type};base64,...` and then into
  // `<img src="${avatar}">`, letting the quote close the attribute.
  it('neutralises an attribute-breaking Content-Type', () => {
    const evil = 'image/png" onerror="alert(1)" data-x="';
    expect(safeMimeType(evil)).toBe('application/octet-stream');
    expect(safeMimeType(evil)).not.toContain('"');
    expect(safeMimeType(evil)).not.toContain('onerror');
  });

  it('never returns a value containing quotes, brackets or spaces', () => {
    for (const evil of [
      'image/png" onerror="x',
      "image/png' onerror='x",
      'image/png><script>alert(1)</script>',
      'image/png javascript:alert(1)',
      'image/svg+xml',
    ]) {
      const out = safeMimeType(evil);
      expect(/["'<>\s]/.test(out)).toBe(false);
    }
  });
});

describe('fileToDataUrl', () => {
  function file(type: string) {
    return new File([new Uint8Array([1, 2, 3, 4])], 'x.bin', { type });
  }

  it('emits a safe data URL for a valid image', async () => {
    const url = await fileToDataUrl(file('image/png'));
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('does not embed an injected Content-Type', async () => {
    const url = await fileToDataUrl(file('image/png" onerror="alert(1)'));
    expect(url).not.toContain('onerror');
    expect(url).not.toContain('"');
    expect(url.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });

  it('returns empty for an empty file', async () => {
    expect(await fileToDataUrl(new File([], 'e.png', { type: 'image/png' }))).toBe('');
  });
});

describe('escapeHtml', () => {
  it('escapes the characters that break out of markup', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a"b')).toBe('a&quot;b');
    expect(escapeHtml("a'b")).toBe('a&#39;b');
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });

  it('escapes quotes so attribute contexts are safe', () => {
    const out = escapeHtml('" onerror="alert(1)');
    expect(out).not.toContain('"');
  });

  it('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('does not double-unescape or drop content', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });
});

describe('safeUrl', () => {
  it('allows well-formed data URLs', () => {
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('rejects a data URL carrying an attribute break-out', () => {
    expect(safeUrl('data:image/png" onerror="alert(1);base64,AAAA')).toBe('');
  });

  it('rejects script-bearing schemes', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBe('');
    expect(safeUrl('vbscript:msgbox')).toBe('');
    expect(safeUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('');
  });

  it('allows http(s) and site-relative paths', () => {
    expect(safeUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeUrl('/uploads/a.png')).toBe('/uploads/a.png');
  });

  it('rejects protocol-relative URLs and blank input', () => {
    expect(safeUrl('//evil.com/x.js')).toBe('');
    expect(safeUrl('')).toBe('');
    expect(safeUrl(null)).toBe('');
  });
});
