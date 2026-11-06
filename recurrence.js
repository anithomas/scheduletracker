'use strict';
/**
 * recurrence.js — shared recurring-event rules (Phase 2, B3).
 *
 * Used by BOTH the browser (index.html, loaded as a plain <script> so its
 * functions land on `window` with no build step) and the server
 * (scripts/send-reminders.js, via `require('../recurrence.js')`), so the
 * calendar and the reminder job can never drift apart on what "this event
 * repeats today" means.
 *
 * All date math is done on UTC epoch-day numbers derived from the Y-M-D
 * digits in each "YYYY-MM-DD" string — never on an ambient `new Date()` or a
 * Date parsed and re-read in the *host's* local time. That makes every
 * function here give the same answer in a browser running in
 * America/Toronto and in a GitHub Actions runner running in UTC, which is
 * exactly the class of bug Phase 1 (B1) fixed for plain due dates.
 *
 * A recurring event (`e.recurrence.type` is 'daily' | 'weekly' | 'monthly')
 * can have two kinds of exception, and both must be honoured:
 *   - a *deleted* single occurrence: its date string sits in
 *     `e.recurrence.exceptions` — isRecurringOnDay() returns false for it.
 *   - a *moved/edited* single occurrence: a separate event doc exists with
 *     `recurringParentId === e.id` and `exceptionDate` set to the date it
 *     replaces. exceptionOverrideDates() collects those so a caller can skip
 *     the series' own computed occurrence on that date (the exception doc
 *     is reminded about on its own, like any other one-off event).
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    var api = factory();
    for (var k in api) root[k] = api[k];
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const DS_RE = /^(\d{4})-(\d{2})-(\d{2})/;

  // "YYYY-MM-DD" -> {y, m (0-based), d}, or null if not parseable.
  function ymd(ds) {
    const m = DS_RE.exec(String(ds || ''));
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }

  // Whole UTC days since the epoch for a "YYYY-MM-DD" string, or null.
  function epochDay(ds) {
    const p = ymd(ds);
    return p ? Math.round(Date.UTC(p.y, p.m, p.d) / 86400000) : null;
  }

  // Day-of-week (0=Sun..6=Sat) for a "YYYY-MM-DD" string, computed in UTC so
  // it never depends on the calling process's timezone.
  function dayOfWeek(ds) {
    const e = epochDay(ds);
    return e === null ? null : new Date(e * 86400000).getUTCDay();
  }

  function daysInMonth(y, mZeroBased) {
    return new Date(Date.UTC(y, mZeroBased + 1, 0)).getUTCDate();
  }

  // "YYYY-MM-DD" (or null) that is `n` calendar days after `ds` (n may be
  // negative). Timezone-independent: pure Y-M-D epoch-day arithmetic.
  function addDays(ds, n) {
    const e = epochDay(ds);
    if (e === null) return null;
    const dt = new Date((e + n) * 86400000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // True if recurring event `e` has an occurrence that falls on `ds`,
  // honouring its end date and its own `exceptions` (deleted-occurrence)
  // list. Does NOT know about separate exception *documents* — see
  // exceptionOverrideDates() for those.
  function isRecurringOnDay(e, ds) {
    if (!e || !e.recurrence || !e.recurrence.type) return false;
    const start = e.date;
    if (!start || !ds || ds < start) return false;
    if (e.recurrence.endDate && ds > e.recurrence.endDate) return false;
    const exceptions = e.recurrence.exceptions || [];
    if (exceptions.includes(ds)) return false;

    const diffDays = epochDay(ds) - epochDay(start);
    if (diffDays === null || Number.isNaN(diffDays)) return false;

    if (e.recurrence.type === 'daily') {
      const interval = e.recurrence.interval || 1;
      return diffDays >= 0 && diffDays % interval === 0;
    }

    if (e.recurrence.type === 'weekly') {
      if (diffDays < 0) return false;
      const interval = e.recurrence.interval || 1;
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks % interval !== 0) return false;
      const daysOfWeek = (e.recurrence.daysOfWeek && e.recurrence.daysOfWeek.length)
        ? e.recurrence.daysOfWeek
        : [dayOfWeek(start)];
      return daysOfWeek.includes(dayOfWeek(ds));
    }

    if (e.recurrence.type === 'monthly') {
      const interval = e.recurrence.interval || 1;
      const s = ymd(start), c = ymd(ds);
      const startMonths = s.y * 12 + s.m;
      const checkMonths = c.y * 12 + c.m;
      const diffM = checkMonths - startMonths;
      if (diffM < 0 || diffM % interval !== 0) return false;
      // Clamp to the last day of the target month: an event on the 31st
      // still fires on Feb 28/29, Apr 30, etc. rather than silently
      // skipping every month that has no such day number.
      const targetDay = Math.min(s.d, daysInMonth(c.y, c.m));
      return c.d === targetDay;
    }

    return false;
  }

  // Next occurrence (YYYY-MM-DD) of recurring event `e` on or after
  // `fromDs`, searching up to `maxDays` ahead. null if none found.
  function getNextOccurrence(e, fromDs, maxDays = 90) {
    if (!e || !e.recurrence || !e.recurrence.type) return null;
    for (let i = 0; i <= maxDays; i++) {
      const ds = addDays(fromDs, i);
      if (ds !== null && isRecurringOnDay(e, ds)) return ds;
    }
    return null;
  }

  // Date strings (YYYY-MM-DD) for which a *separate* exception doc exists
  // that replaces the series' own occurrence of recurring event `parentId`
  // — i.e. every `exceptionDate` on an event with
  // `recurringParentId === parentId`. The series must not also remind about
  // these dates; the exception doc gets reminded about on its own (it's a
  // normal one-off event with its own `.date`).
  function exceptionOverrideDates(parentId, allEvents) {
    const dates = new Set();
    (allEvents || []).forEach(ev => {
      if (ev.recurringParentId === parentId && ev.exceptionDate) dates.add(ev.exceptionDate);
    });
    return dates;
  }

  return {
    ymd, epochDay, dayOfWeek, addDays,
    isRecurringOnDay, getNextOccurrence, exceptionOverrideDates,
  };
});
