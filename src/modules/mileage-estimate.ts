// ─── MILEAGE-BASED DUE-DATE ESTIMATE (Phase 4, F5) ──────────────
// Auto records already capture an odometer reading on every "Mark done" that
// has a km interval set (mark-done.ts's markDone(), when kmInterval > 0) —
// both as the record's own current `mileage`/`lastDate`, and as `{doneOn,
// mileage}` on each entry pushed onto `history`. This module turns that
// trail of dated odometer readings into a km/day usage rate, then projects
// a calendar date for when the vehicle will reach `nextMileage` at that pace.
//
// Deliberately informational only: this never changes `nextDate` itself, and
// nothing here feeds statusBadge()/progressBar() or the reminder scripts —
// those stay driven by the time-based interval exactly as before. Showing a
// *second*, clearly-labeled estimate next to the existing one lets the
// household judge which is closer to reality (e.g. a car driven far less
// than usual over winter) without silently changing what "overdue" means
// everywhere else in the app.
//
// No test file alongside this one, matching nextOccurrence()/isRecurring()
// in mark-done.ts (the closest analog) — this project's TS modules don't
// have a unit-test harness; only scripts/*.js (plain Node, no Firebase at
// module load) do.

export interface MileagePoint { date: string; mileage: number }

// Every dated odometer reading we have for a record, oldest first. A date
// appearing twice (shouldn't happen — each markDone() call stamps a distinct
// `doneOn`) keeps the later-seen reading rather than erroring.
export function mileagePoints(record: any): MileagePoint[] {
  const byDate = new Map<string, number>();
  (record?.history || []).forEach((h: any) => {
    const m = Number(h?.mileage) || 0;
    if (h?.doneOn && m > 0) byDate.set(h.doneOn, m);
  });
  const curMileage = Number(record?.mileage) || 0;
  if (record?.lastDate && curMileage > 0) byDate.set(record.lastDate, curMileage);
  return [...byDate.entries()]
    .map(([date, mileage]) => ({ date, mileage }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// Average km driven per calendar day, from the earliest reading we have to
// the latest. Null when there isn't enough history (fewer than two distinct
// dated readings), no time has actually elapsed between them, or mileage
// didn't increase (a parked vehicle, an odometer correction, bad data) — any
// of which would make a projected date meaningless or divide-by-zero.
export function kmPerDay(record: any): number | null {
  const pts = mileagePoints(record);
  if (pts.length < 2) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const days = (Date.parse(last.date) - Date.parse(first.date)) / 86400000;
  const km = last.mileage - first.mileage;
  if (!(days > 0) || !(km > 0)) return null;
  return km / days;
}

// "YYYY-MM-DD" the vehicle is projected to reach `record.nextMileage` at its
// recent km/day pace, or null when there isn't a usable rate, no mileage
// target is set, or the vehicle has already reached it (the existing
// overdue/status badge already covers that case via the time-based date).
export function estimateDateFromMileage(record: any, now: Date = new Date()): string | null {
  const target = Number(record?.nextMileage) || 0;
  const current = Number(record?.mileage) || 0;
  if (!target || target <= current) return null;
  const rate = kmPerDay(record);
  if (!rate) return null;
  const daysRemaining = Math.ceil((target - current) / rate);
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysRemaining);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
