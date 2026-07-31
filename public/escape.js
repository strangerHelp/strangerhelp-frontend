// Global HTML-escaping helpers for inline page scripts.
// The client renders markup with template literals, so every interpolated
// user value must be escaped or it becomes an XSS vector.
(function () {
  function escapeHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Validate a URL destined for src/href. Blocks javascript:, attribute
  // break-outs, and malformed data: URLs. Returns '' when unsafe.
  function safeUrl(v) {
    if (v === null || v === undefined) return '';
    var raw = String(v).trim();
    if (!raw) return '';
    if (/["'<>\s]/.test(raw)) return '';
    var lower = raw.toLowerCase();
    if (lower.indexOf('data:') === 0) {
      return /^data:(image|audio|video|application)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(raw) ? raw : '';
    }
    if (lower.indexOf('http://') === 0 || lower.indexOf('https://') === 0) return raw;
    if (raw.charAt(0) === '/' && raw.charAt(1) !== '/') return raw;
    return '';
  }

  window.escapeHtml = escapeHtml;
  window.esc = window.esc || escapeHtml;
  window.safeUrl = safeUrl;
})();
