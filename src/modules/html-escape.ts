// ─── HTML ESCAPING ───────────────────────────────────────────
// All user-supplied strings (titles, notes, names, locations…) are rendered
// via innerHTML template literals. Escape them so a value like
// <img src=x onerror=...> is displayed as text instead of executing.
const _HTML_ESC: Record<string, string> = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
export function esc(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => _HTML_ESC[c]);
}
// For values placed inside a single-quoted inline handler, e.g. onclick="f('${…}')"
export function escJs(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;')
                  .replace(/</g,'\\x3C').replace(/>/g,'\\x3E').replace(/\r?\n/g,' ');
}
// Only allow http(s) URLs in href/src to block javascript: and data: payloads
export function safeUrl(u: unknown): string {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? esc(s) : '#';
}
