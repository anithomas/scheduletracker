// ─── SAVE GUARDS & ERROR MESSAGES ────────────────────────────
import { closeModal } from './modal';
import { renderAuto } from './auto';
import { renderHome } from './home';
import { renderCalendar } from './calendar';
import { checkAndShowReminders } from './notifications';

// Disables the modal's save button while a write is in flight, so an impatient
// double-tap can't create two records (or fire two conflicting writes).
// Map<modalId, buttonElement> — the button captured at beginSave() time.
// Previously this re-found the button by matching /save|add/i in its text,
// which broke as soon as beginSave() changed the text to "⏳ Saving…" (that
// string doesn't contain the substring "save"), so endSave() could never find
// it again and the button stayed disabled forever. Holding a direct reference
// removes the re-lookup entirely.
export const _savingModals = new Map<string, HTMLButtonElement | null>();
export function _saveBtn(modalId: string): HTMLButtonElement | null {
  const m = document.getElementById(modalId);
  if (!m) return null;
  return [...m.querySelectorAll('button')].find(b => /save|add/i.test(b.textContent || '')) || null;
}
export function beginSave(modalId: string) {
  if (_savingModals.has(modalId)) return false;   // already saving — ignore
  const b = _saveBtn(modalId);
  _savingModals.set(modalId, b || null);
  if (b){ b.dataset.prevLabel = b.textContent || ''; (b as HTMLButtonElement).disabled = true; b.textContent = '⏳ Saving…'; }
  return true;
}
export function endSave(modalId: string) {
  const b = _savingModals.get(modalId) || _saveBtn(modalId); // fallback just in case
  _savingModals.delete(modalId);
  if (b){ (b as HTMLButtonElement).disabled = false; if (b.dataset.prevLabel) { b.textContent = b.dataset.prevLabel; delete b.dataset.prevLabel; } }
}

export function friendlyError(err: any) {
  const code = (err && err.code) || '';
  if (code === 'permission-denied')  return 'you don’t have permission for this change.';
  if (code === 'unavailable')        return 'no connection. Check your network and try again.';
  if (code === 'resource-exhausted') return 'the database quota was reached. Try again later.';
  if (code === 'not-found')          return 'that record no longer exists.';
  if (code === 'unauthenticated')    return 'your session expired. Please sign in again.';
  if (code === 'timeout')            return 'the save took too long. Check your connection and try again.';
  return (err && err.message) ? err.message : 'unknown error.';
}

// Prevents a stalled network write from hanging forever with the Save button
// stuck disabled. If the write hasn't settled within `ms`, this rejects — the
// underlying Firestore write may still complete later in the background, but
// the UI stops waiting and lets the user retry rather than being stranded.
export function withTimeout<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject({ code: 'timeout' }), ms)),
  ]);
}

// Tap the dark overlay backdrop to close any modal (mobile UX)
document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if(t.classList.contains('modal-overlay') && t.classList.contains('open')){
    closeModal(t.id);
  }
}, {passive:true});

export let autoRecords: any[] = [], homeItems: any[] = [], events: any[] = [], renewals: any[] = [];
// Setters for the two cross-module writers (the Firestore listeners in
// listeners.ts) — a different module can't reassign an imported `let`
// binding directly, only the module that declares it can, so the write
// goes through here instead of `autoRecords = …` at the call site.
export function setAutoRecords(v: any[]) { autoRecords = v; }
export function setHomeItems(v: any[]) { homeItems = v; }
export function setEvents(v: any[]) { events = v; }
export function setRenewals(v: any[]) { renewals = v; }

// NOW/TODAY are mutable and refreshed by refreshToday() — a tab left open
// overnight would otherwise keep calculating "days until" against a stale date,
// making overdue badges and progress bars wrong until a manual reload.
export let NOW   = new Date();
export let calYear  = NOW.getFullYear();
export let calMonth = NOW.getMonth();
export let TODAY = new Date(); TODAY.setHours(0,0,0,0);
export let unsubs: Array<() => void> = [];
// calYear/calMonth are written from calendar.ts (changeMonth/goToday);
// unsubs is written from auth.ts and listeners.ts — same reasoning as above.
export function setCalYear(v: number) { calYear = v; }
export function setCalMonth(v: number) { calMonth = v; }
export function setUnsubs(v: Array<() => void>) { unsubs = v; }

// Local-timezone YYYY-MM-DD. Using toISOString() here would convert to UTC,
// which rolls over to "tomorrow" after ~7pm EST and shifts every date-based
// comparison in the app by a day.
export function toDs(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function todayDs(){ return toDs(new Date()); }

// Parse "YYYY-MM-DD" as LOCAL midnight. new Date("2026-10-31") is UTC midnight,
// which in Toronto is 8 pm the previous day, so every due date read one day
// early (due today showed "Overdue 1d", due tomorrow showed "Due in 0d").
export function parseDs(ds: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ds || ''));
  return m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(ds);
}

// Returns true if the calendar day changed (callers can re-render on true)
export function refreshToday(){
  const fresh = new Date(); fresh.setHours(0,0,0,0);
  if (fresh.getTime() === TODAY.getTime()) return false;
  TODAY = fresh;
  NOW   = new Date();
  return true;
}

// Re-render when the day rolls over (checked every minute) and whenever the
// user returns to a backgrounded tab.
// A new day also refreshes the reminder banner (startListeners only checks once).
setInterval(() => { if (refreshToday()) { rerenderAll(); try { checkAndShowReminders(); } catch(e){} } }, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && refreshToday()) { rerenderAll(); try { checkAndShowReminders(); } catch(e){} }
});

export function rerenderAll(){
  try { renderAuto(); } catch(e){}
  try { renderHome(); } catch(e){}
  try { renderCalendar(); } catch(e){}
}
