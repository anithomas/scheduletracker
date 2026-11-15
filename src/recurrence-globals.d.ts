// recurrence.js stays a plain, non-module <script src="/recurrence.js"> tag
// (Phase 3, R4) — it's shared verbatim with scripts/send-reminders.js via
// `require('../recurrence.js')`, so it can't become an ES module without
// touching the server-side reminder job too. It's loaded before the Vite
// bundle and lands on `window` exactly as it always has; these ambient
// declarations just give the TypeScript modules that call it real types
// instead of treating it as `any`.
interface RecurrenceRule {
  type: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  daysOfWeek?: number[];
  endDate?: string;
  exceptions?: string[];
}
interface RecurringEntity {
  date?: string;
  recurrence?: RecurrenceRule;
  [key: string]: any;
}

declare global {
  function ymd(ds: string): { y: number; m: number; d: number } | null;
  function epochDay(ds: string): number | null;
  function dayOfWeek(ds: string): number | null;
  function addDays(ds: string, n: number): string | null;
  function isRecurringOnDay(e: RecurringEntity, ds: string): boolean;
  function getNextOccurrence(e: RecurringEntity, fromDs: string, maxDays?: number): string | null;
  function exceptionOverrideDates(parentId: string, allEvents: any[]): Set<string>;

  // Google Identity Services (gsi/client), loaded as an external <script> for
  // Google Calendar sync (Phase 4) — not an npm package, kept as a global.
  const google: any;
}
export {};
