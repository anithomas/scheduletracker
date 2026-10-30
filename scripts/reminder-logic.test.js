'use strict';
// Run with:  node --test scripts/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('./reminder-logic');

// 13:00 UTC on Oct 30 2026 = 09:00 in Toronto (EDT) — when the daily job runs.
const MORNING = new Date('2026-10-30T13:00:00Z');

test('daysUntil counts calendar days in Toronto', () => {
  assert.equal(L.daysUntil('2026-10-30', MORNING), 0);
  assert.equal(L.daysUntil('2026-10-31', MORNING), 1);
  assert.equal(L.daysUntil('2026-11-06', MORNING), 7);
  assert.equal(L.daysUntil('2026-10-29', MORNING), -1);
});

test('daysUntil uses Toronto "today", not UTC "today"', () => {
  // 01:30 UTC on Oct 31 is still 9:30 pm Oct 30 in Toronto.
  const lateEvening = new Date('2026-10-31T01:30:00Z');
  assert.equal(L.torontoDateString(lateEvening), '2026-10-30');
  assert.equal(L.daysUntil('2026-10-30', lateEvening), 0);
});

test('daysUntil is unaffected by the DST change (Nov 1 2026)', () => {
  assert.equal(L.daysUntil('2026-11-02', MORNING), 3);
  assert.equal(L.daysUntil('2026-11-02', new Date('2026-11-01T14:00:00Z')), 1);
});

test('daysUntil returns null for missing or garbage dates', () => {
  assert.equal(L.daysUntil('', MORNING), null);
  assert.equal(L.daysUntil(undefined, MORNING), null);
  assert.equal(L.daysUntil('not-a-date', MORNING), null);
});

test('shouldRemind fires only on lead days and the day itself', () => {
  const lead = [1, 7];
  const fires = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8].filter(d => L.shouldRemind(d, lead));
  assert.deepEqual(fires, [0, 1, 7]); // old `d <= lead` rule fired on all of 0..7
});

test('shouldRemind tolerates string lead times and missing settings', () => {
  assert.equal(L.shouldRemind(3, ['3']), true);
  assert.equal(L.shouldRemind(3, undefined), false);
  assert.equal(L.shouldRemind(null, [1, 7]), false);
});

test('shouldRemindOverdue: day after, then weekly', () => {
  const fires = [];
  for (let d = 2; d >= -15; d--) if (L.shouldRemindOverdue(d)) fires.push(d);
  assert.deepEqual(fires, [-1, -7, -14]);
});

test('dayLabel', () => {
  assert.equal(L.dayLabel(0), 'Today');
  assert.equal(L.dayLabel(1), 'Tomorrow');
  assert.equal(L.dayLabel(5), 'In 5 days');
  assert.equal(L.dayLabel(-1), 'Overdue by 1 day');
  assert.equal(L.dayLabel(-9), 'Overdue by 9 days');
});

test('isDeadTokenError only matches permanent token failures', () => {
  assert.equal(L.isDeadTokenError('messaging/registration-token-not-registered'), true);
  assert.equal(L.isDeadTokenError('messaging/invalid-registration-token'), true);
  assert.equal(L.isDeadTokenError('messaging/server-unavailable'), false);
  assert.equal(L.isDeadTokenError(undefined), false);
});

test('removeTokens handles string and object tokens and leaves others untouched', () => {
  const members = [
    { name: 'Ani', fcmTokens: ['a', { token: 'b', os: 'x' }, 'c'] },
    { name: 'Anju', fcmTokens: ['d'] },
    { name: 'Kevin' },
  ];
  const { members: next, removed } = L.removeTokens(members, new Set(['b', 'c']));
  assert.equal(removed, 2);
  assert.deepEqual(next[0].fcmTokens, ['a']);
  assert.equal(next[1], members[1]); // same object: unchanged
  assert.equal(next[2], members[2]);
});
