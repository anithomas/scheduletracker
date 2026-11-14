// ─── DISPLAY NAMES & INITIALS ────────────────────────────────
export function getInitials(name: string, allNames: string[]) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].substring(0,2).toUpperCase();
  const first = parts[0][0].toUpperCase();
  const last  = parts[parts.length-1];
  const def   = first + last[0].toUpperCase();
  // Conflict check: another member has the same default initials?
  const conflict = (allNames||[]).some(n => {
    if (n === name) return false;
    const p = n.trim().split(/\s+/).filter(Boolean);
    return p.length > 1 && (p[0][0]+p[p.length-1][0]).toUpperCase() === def;
  });
  if (conflict) return (last[last.length-1] + first).toUpperCase(); // e.g. nA
  return def;
}
export function memberDisplayName(m: any) { return (m.nickname||'').trim() || m.name; }
export function vehicleDisplayName(v: any) { return (v.nickname||'').trim() || v.name; }
