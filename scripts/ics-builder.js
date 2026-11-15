'use strict';
/**
 * ics-builder.js — Phase 4, F8: pure iCalendar (RFC 5545) formatting.
 *
 * Deliberately separate from reminder-logic.js: that module decides *when*
 * to remind; this one only decides *how to format* a VCALENDAR/VEVENT once
 * the caller (generate-ics-feeds.js) has already picked which items belong
 * in a given member's feed. No Firestore, no network, no Date.now() unless
 * explicitly passed in — every function here is a pure string transform,
 * so it's unit-testable the same way recurrence.js and reminder-logic.js
 * already are.
 *
 * This is the "sturdier replacement" for B6 the proposal describes: instead
 * of pushing one-off events to Google Calendar via API calls that go stale
 * (B6), each member subscribes once to a feed URL and their calendar app
 * re-pulls it on its own schedule. Recurrence is expressed as a native
 * RRULE/EXDATE rather than expanded into hundreds of individual VEVENTs, so
 * "edit one occurrence" and "this repeats forever" both survive a refresh
 * the way a real calendar expects.
 */

// RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma, and embedded
// newlines. Order matters — backslash first, or the later escapes would
// double-escape their own inserted backslashes.
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// RFC 5545 §3.1: a content line over 75 octets must be folded onto a
// continuation line that starts with a single space. Folding by UTF-16
// code-unit count (rather than true UTF-8 octets) can fold a few characters
// early for multi-byte text (emoji titles) — that only ever produces a
// *shorter* line than the limit requires, never a line that breaks the
// limit, so it's a safe approximation for this app's short, mostly-ASCII
// summaries.
function foldLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

function joinFolded(lines) {
  return lines.map(foldLine).join('\r\n');
}

// 'YYYY-MM-DD' -> 'YYYYMMDD' (the VALUE=DATE form used for all-day items).
function toIcsDate(ds) {
  return (ds || '').replace(/-/g, '');
}

// A floating local date-time (no Z, no TZID): every date/time in this app
// is already Toronto wall-clock with no stored offset (see
// reminder-logic.js's TZ handling), and a floating time is exactly how
// RFC 5545 represents "this is a wall-clock time, render it in whatever
// zone the viewer is in" — which for one household is the right behaviour.
function toIcsDateTime(ds, time) {
  const t = (time || '00:00').split(':');
  const hh = (t[0] || '00').padStart(2, '0');
  const mm = (t[1] || '00').padStart(2, '0');
  return `${toIcsDate(ds)}T${hh}${mm}00`;
}

// UTC timestamp for DTSTAMP, e.g. '20261114T231500Z'. Takes `now` so callers
// (and tests) can pin the clock instead of depending on the real one.
function nowStamp(now) {
  const d = now || new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
         `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// Our recurrence model -> RRULE. Returns null for a one-off event or an
// unrecognized type (caller simply omits RRULE in that case).
//
// Known fidelity gap, intentionally not worked around: this app's monthly
// recurrence *clamps* an out-of-range day to the month's last day (a "31st"
// event still fires Feb 28), but RFC 5545's FREQ=MONTHLY with no BYMONTHDAY
// override instead *skips* months that don't have DTSTART's day-of-month.
// Expressing "clamped" recurrence in iCal would need per-anomalous-month
// RDATE overrides — more complexity than a day/month-boundary edge case
// warrants for an "Effort: M" feature; day-of-month events in the common
// case (anything ≤28) are unaffected either way.
function buildRRule(recurrence) {
  if (!recurrence || !recurrence.type) return null;
  const freqByType = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
  const freq = freqByType[recurrence.type];
  if (!freq) return null;
  const parts = [`FREQ=${freq}`];
  const interval = recurrence.interval || 1;
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (recurrence.type === 'weekly' && recurrence.daysOfWeek && recurrence.daysOfWeek.length) {
    parts.push(`BYDAY=${recurrence.daysOfWeek.map(d => DOW[d]).join(',')}`);
  }
  if (recurrence.endDate) parts.push(`UNTIL=${toIcsDate(recurrence.endDate)}T235959Z`);
  return parts.join(';');
}

// Deleted single occurrences (recurrence.exceptions, a list of date
// strings) -> one EXDATE property. null when there are none, so the caller
// can omit the line entirely rather than emit an empty EXDATE.
function buildExdateLine(recurrence) {
  if (!recurrence || !recurrence.exceptions || !recurrence.exceptions.length) return null;
  return 'EXDATE;VALUE=DATE:' + recurrence.exceptions.map(toIcsDate).join(',');
}

// One VEVENT's lines (unfolded — folding happens once, for the whole
// calendar, in buildCalendar). `allDay` picks DATE vs DATE-TIME throughout,
// including on RECURRENCE-ID, which per RFC 5545 §3.8.4.4 must use the same
// value type as the series' own DTSTART.
function buildVevent({ uid, summary, description, location, ds, time, allDay, rrule, exdateLine, recurrenceIdDs, now }) {
  const dt = allDay ? toIcsDate(ds) : toIcsDateTime(ds, time);
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${nowStamp(now)}`];
  lines.push(allDay ? `DTSTART;VALUE=DATE:${dt}` : `DTSTART:${dt}`);
  if (recurrenceIdDs) {
    const rid = allDay ? toIcsDate(recurrenceIdDs) : toIcsDateTime(recurrenceIdDs, time);
    lines.push(allDay ? `RECURRENCE-ID;VALUE=DATE:${rid}` : `RECURRENCE-ID:${rid}`);
  }
  lines.push(`SUMMARY:${escapeText(summary)}`);
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (location) lines.push(`LOCATION:${escapeText(location)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (exdateLine) lines.push(exdateLine);
  lines.push('END:VEVENT');
  return lines;
}

// Wraps a flat list of already-built VEVENT line-arrays into one folded
// VCALENDAR document, CRLF-terminated per RFC 5545 §3.1.
function buildCalendar(calName, veventLineArrays) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Thomas Family Tracker//ICS Feed//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(calName)}`,
    ...veventLineArrays.flat(),
    'END:VCALENDAR',
  ];
  return joinFolded(lines) + '\r\n';
}

// A member sees an event if they're explicitly on it, or if it names no
// member at all (a shared/family event) — the same "no name = everyone"
// convention send-reminders.js already uses for push/SMS targeting.
function eventVisibleTo(e, memberName) {
  const names = e.members && e.members.length ? e.members : (e.member ? [e.member] : []);
  return names.length === 0 || names.includes(memberName);
}

// An auto/home item is this member's if it's assigned to them, or
// unassigned (shared) — same convention F7 (resolveAssigneeTargets) uses
// for reminder targeting.
function itemVisibleTo(item, memberName) {
  return !item.assignedTo || item.assignedTo === memberName;
}

// Builds every VEVENT line-array for one member's feed from already-fetched
// collections. Pure given its inputs (including `now`, for a stable
// DTSTAMP) — the caller (generate-ics-feeds.js) does all the Firestore I/O
// and simply passes the plain arrays in.
function buildMemberVevents(memberName, events, autoRecords, homeItems, now) {
  const veventLines = [];

  (events || []).forEach(e => {
    if (e.completed) return;
    if (!eventVisibleTo(e, memberName)) return;
    const allDay = !e.time;

    if (e.recurringParentId) {
      // A moved/edited single occurrence of some other series — RECURRENCE-ID
      // must share the parent's UID and the parent's all-day/timed value type.
      veventLines.push(buildVevent({
        uid: `evt-${e.recurringParentId}`,
        summary: e.title, description: e.notes, location: e.location,
        ds: e.date, time: e.time, allDay,
        recurrenceIdDs: e.exceptionDate,
        now,
      }));
      return;
    }

    if (e.recurrence && e.recurrence.type) {
      veventLines.push(buildVevent({
        uid: `evt-${e.id}`,
        summary: e.title, description: e.notes, location: e.location,
        ds: e.date, time: e.time, allDay,
        rrule: buildRRule(e.recurrence),
        exdateLine: buildExdateLine(e.recurrence),
        now,
      }));
      return;
    }

    veventLines.push(buildVevent({
      uid: `evt-${e.id}`,
      summary: e.title, description: e.notes, location: e.location,
      ds: e.date, time: e.time, allDay,
      now,
    }));
  });

  // Due dates, not events: no RRULE (nextDate shifts dynamically on
  // completion rather than following a fixed rule), but a stable UID per
  // record means a calendar app sees a shifted nextDate as an edit to the
  // same event on the next feed refresh, not a duplicate.
  (autoRecords || []).forEach(r => {
    if (r.completed || !r.nextDate) return;
    if (!itemVisibleTo(r, memberName)) return;
    const vehicle = r.vehicleName || r.vehicle || '';
    veventLines.push(buildVevent({
      uid: `auto-${r.id}`,
      summary: `🚗 ${r.service}${vehicle ? ' — ' + vehicle : ''}`,
      ds: r.nextDate, allDay: true, now,
    }));
  });

  (homeItems || []).forEach(h => {
    if (h.completed || !h.nextDate) return;
    if (!itemVisibleTo(h, memberName)) return;
    veventLines.push(buildVevent({
      uid: `home-${h.id}`,
      summary: `🏡 ${h.item || h.description || 'Home maintenance'}`,
      ds: h.nextDate, allDay: true, now,
    }));
  });

  return veventLines;
}

module.exports = {
  escapeText, foldLine, joinFolded, toIcsDate, toIcsDateTime, nowStamp,
  buildRRule, buildExdateLine, buildVevent, buildCalendar,
  eventVisibleTo, itemVisibleTo, buildMemberVevents,
};
