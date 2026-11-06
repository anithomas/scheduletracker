'use strict';
// Unit tests for recurrence.js (Phase 2, R5) — the shared module
// scripts/send-reminders.js requires and index.html loads as a <script>.
// Run with: node --test scripts/ (from the repo root) or npm test (from scripts/).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recurrence');

test('isRecurringOnDay: not a recurring event at all', () => {
  assert.equal(R.isRecurringOnDay({ date: '2026-01-05' }, '2026-01-05'), false);
  assert.equal(R.isRecurringOnDay(null, '2026-01-05'), false);
});

test('isRecurringOnDay: daily, every N days, never before the start date', () => {
  const e = { date: '2026-01-05', recurrence: { type: 'daily', interval: 3 } };
  assert.equal(R.isRecurringOnDay(e, '2026-01-04'), false); // before start
  assert.equal(R.isRecurringOnDay(e, '2026-01-05'), true);  // start itself
  assert.equal(R.isRecurringOnDay(e, '2026-01-06'), false);
  assert.equal(R.isRecurringOnDay(e, '2026-01-08'), true);  // +3
  assert.equal(R.isRecurringOnDay(e, '2026-01-11'), true);  // +6
  assert.equal(R.isRecurringOnDay(e, '2026-01-10'), false); // +5, not a multiple of 3
});

test('isRecurringOnDay: weekly, specific days of the week, interval in weeks', () => {
  // 2026-01-05 is a Monday.
  const e = {
    date: '2026-01-05',
    recurrence: { type: 'weekly', interval: 2, daysOfWeek: [1, 3] }, // Mon, Wed
  };
  assert.equal(R.isRecurringOnDay(e, '2026-01-05'), true);  // week 0, Mon
  assert.equal(R.isRecurringOnDay(e, '2026-01-07'), true);  // week 0, Wed
  assert.equal(R.isRecurringOnDay(e, '2026-01-12'), false); // week 1 (skipped — interval 2)
  assert.equal(R.isRecurringOnDay(e, '2026-01-19'), true);  // week 2, Mon
  assert.equal(R.isRecurringOnDay(e, '2026-01-21'), true);  // week 2, Wed
  assert.equal(R.isRecurringOnDay(e, '2026-01-20'), false); // week 2, Tue — not a chosen day
});

test('isRecurringOnDay: weekly with no daysOfWeek defaults to the start date\'s weekday', () => {
  const e = { date: '2026-01-05', recurrence: { type: 'weekly', interval: 1 } }; // Monday
  assert.equal(R.isRecurringOnDay(e, '2026-01-12'), true);  // next Monday
  assert.equal(R.isRecurringOnDay(e, '2026-01-13'), false); // Tuesday
});

test('isRecurringOnDay: monthly, clamped to the last day of a shorter month', () => {
  const e = { date: '2026-01-31', recurrence: { type: 'monthly', interval: 1 } };
  assert.equal(R.isRecurringOnDay(e, '2026-02-28'), true);  // Feb has no 31st in 2026
  assert.equal(R.isRecurringOnDay(e, '2026-02-27'), false);
  assert.equal(R.isRecurringOnDay(e, '2026-03-31'), true);
  assert.equal(R.isRecurringOnDay(e, '2026-04-30'), true);  // April has no 31st
});

test('isRecurringOnDay: monthly respects an interval of more than one month', () => {
  const e = { date: '2026-01-15', recurrence: { type: 'monthly', interval: 3 } };
  assert.equal(R.isRecurringOnDay(e, '2026-02-15'), false);
  assert.equal(R.isRecurringOnDay(e, '2026-04-15'), true);
  assert.equal(R.isRecurringOnDay(e, '2026-07-15'), true);
});

test('isRecurringOnDay: respects endDate', () => {
  const e = { date: '2026-01-01', recurrence: { type: 'daily', interval: 1, endDate: '2026-01-10' } };
  assert.equal(R.isRecurringOnDay(e, '2026-01-10'), true);
  assert.equal(R.isRecurringOnDay(e, '2026-01-11'), false);
});

test('isRecurringOnDay: a deleted single occurrence (recurrence.exceptions) never fires', () => {
  const e = {
    date: '2026-01-01',
    recurrence: { type: 'daily', interval: 1, exceptions: ['2026-01-05'] },
  };
  assert.equal(R.isRecurringOnDay(e, '2026-01-04'), true);
  assert.equal(R.isRecurringOnDay(e, '2026-01-05'), false);
  assert.equal(R.isRecurringOnDay(e, '2026-01-06'), true);
});

test('isRecurringOnDay is unaffected by the DST change (Nov 1 2026) or process timezone', () => {
  // Weekly on Sundays, straddling Ontario's Nov 1 2026 fall-back.
  const e = { date: '2026-10-25', recurrence: { type: 'weekly', interval: 1, daysOfWeek: [0] } };
  assert.equal(R.isRecurringOnDay(e, '2026-11-01'), true);
  assert.equal(R.isRecurringOnDay(e, '2026-11-08'), true);
  assert.equal(R.isRecurringOnDay(e, '2026-11-02'), false);
});

test('exceptionOverrideDates collects exception-doc dates for one parent only', () => {
  const events = [
    { id: 'series-1', recurrence: { type: 'weekly' } },
    { id: 'ex1', recurringParentId: 'series-1', exceptionDate: '2026-01-12', date: '2026-01-13' },
    { id: 'ex2', recurringParentId: 'series-1', exceptionDate: '2026-01-19', date: '2026-01-19' },
    { id: 'ex3', recurringParentId: 'other-series', exceptionDate: '2026-01-12' },
    { id: 'plain', date: '2026-01-20' },
  ];
  const dates = R.exceptionOverrideDates('series-1', events);
  assert.deepEqual([...dates].sort(), ['2026-01-12', '2026-01-19']);
  assert.equal(R.exceptionOverrideDates('nonexistent', events).size, 0);
});

test('getNextOccurrence finds the next matching date, honouring exceptions', () => {
  const e = {
    date: '2026-01-05',
    recurrence: { type: 'weekly', interval: 1, exceptions: ['2026-01-12'] },
  };
  assert.equal(R.getNextOccurrence(e, '2026-01-06'), '2026-01-19'); // 01-12 is excepted
  assert.equal(R.getNextOccurrence(e, '2026-01-05'), '2026-01-05'); // fromDs itself counts
});

test('getNextOccurrence returns null when nothing matches within maxDays, or event is not recurring', () => {
  const e = { date: '2026-01-05', recurrence: { type: 'monthly', interval: 1 } };
  assert.equal(R.getNextOccurrence(e, '2026-01-06', 20), null); // next is Feb 5, > 20 days out
  assert.equal(R.getNextOccurrence({ date: '2026-01-05' }, '2026-01-06'), null);
});

test('addDays is pure Y-M-D arithmetic, immune to DST and month/year rollover', () => {
  assert.equal(R.addDays('2026-10-30', 2), '2026-11-01'); // crosses the Nov 1 DST change
  assert.equal(R.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(R.addDays('2026-03-05', -10), '2026-02-23');
  assert.equal(R.addDays('not-a-date', 1), null);
});

test('dayOfWeek matches known calendar dates regardless of host timezone', () => {
  assert.equal(R.dayOfWeek('2026-01-05'), 1); // Monday
  assert.equal(R.dayOfWeek('2026-11-01'), 0); // Sunday
});
