/**
 * Only absolute http(s) links are accepted for links that the browser will
 * open, so a stored `javascript:` or `data:` value can never become a clickable
 * script or inline document.
 */
export function normalizeHttpUrl(value, { maxLength = 2000 } = {}) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) return '';

  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.toString();
  } catch {
    return '';
  }
}
