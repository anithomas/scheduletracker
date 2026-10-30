'use strict';
/**
 * reminder-logic.js — pure date/reminder rules used by send-reminders.js.
 * No Firebase, no network, no process.env: everything is a function of its
 * arguments so it can be unit-tested (see reminder-logic.test.js).
 */

const TZ = 'America/Toronto';

// "YYYY-MM-DD" for the given instant as seen in Toronto.
function torontoDateString(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// Whole days since the epoch for a "YYYY-MM-DD" string. Calendar arithmetic in
// UTC, so DST changes and the runner's own timezone can never shift the result.
function dayNumber(ds) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ds || ''));
  if (!m) return null;
  return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
}

// Calendar days from Toronto's "today" until dateStr (negative = overdue).
function daysUntil(dateStr, now = new Date()) {
  const target = dayNumber(dateStr);
  const today = dayNumber(torontoDateString(now));
  if (target === null || today === null) return null;
  return target - today;
}

// Remind on the day itself and on each configured lead time, exactly once.
// (The old rule was `d <= lead`, which re-sent every morning for the whole
// window: with lead times [1, 7] an item got up to 8 pushes and 8 texts.)
function shouldRemind(d, leadTimes) {
  if (d === null || d === undefined) return false;
  const leads = (leadTimes || []).map(Number).filter(Number.isFinite);
  return d === 0 || leads.includes(d);
}

// Overdue items: the day after they were due, then weekly — never silent,
// never daily nagging.
function shouldRemindOverdue(d) {
  return d !== null && d !== undefined && d < 0 && (d === -1 || d % 7 === 0);
}

function dayLabel(d) {
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? '' : 's'}`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

// FCM error codes that mean the device token will never work again.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
function isDeadTokenError(code) {
  return DEAD_TOKEN_CODES.has(code);
}

// Remove the given tokens from a members array (tokens may be plain strings or
// {token, ...} objects). Returns the new array and how many were removed.
function removeTokens(members, dead) {
  let removed = 0;
  const next = (members || []).map(m => {
    const toks = m.fcmTokens || [];
    const kept = toks.filter(t => !dead.has(typeof t === 'object' && t ? t.token : t));
    removed += toks.length - kept.length;
    return kept.length === toks.length ? m : { ...m, fcmTokens: kept };
  });
  return { members: next, removed };
}

module.exports = {
  TZ, torontoDateString, dayNumber, daysUntil, shouldRemind,
  shouldRemindOverdue, dayLabel, isDeadTokenError, removeTokens,
};
