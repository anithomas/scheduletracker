// ─── CSV EXPORT (Phase 4, F4) ──────────────────────
// Reports were print-only — no way to get the numbers into a spreadsheet.
// Minimal client-side CSV, no library: this app's export data is short text
// and dollar amounts, nothing that needs a real CSV parser to produce
// (proposal rates this feature "Effort: S").

// Quote a field only when it needs it (contains a comma, quote, or newline),
// doubling any embedded quotes — the one escaping rule CSV actually has.
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(r => lines.push(r.map(csvCell).join(',')));
  // Leading BOM: Excel on Windows otherwise mis-detects the encoding and
  // mangles anything outside plain ASCII.
  return '﻿' + lines.join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
