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

test('addDays is pure Y-M-D arithmetic, immune to DST and month/year rollover', () => {
  assert.equal(L.addDays('2026-10-30', 2), '2026-11-01'); // crosses the Nov 1 DST change
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2026-03-05', -10), '2026-02-23');
  assert.equal(L.addDays('garbage', 1), null);
});

test('torontoDatePlusDays offsets Toronto\'s "today", not UTC "today"', () => {
  // 01:30 UTC on Oct 31 is still 9:30 pm Oct 30 in Toronto — "+1 day" from
  // here must land on Oct 31, not Nov 1.
  const lateEvening = new Date('2026-10-31T01:30:00Z');
  assert.equal(L.torontoDatePlusDays(0, lateEvening), '2026-10-30');
  assert.equal(L.torontoDatePlusDays(1, lateEvening), '2026-10-31');
  assert.equal(L.torontoDatePlusDays(7, MORNING), '2026-11-06');
});

test('resolveAssigneeTargets: no assignee reminds everyone (Phase 4, F7)', () => {
  const memberTokens = { Ani: ['tok-ani'] };
  const smsGateways = { Ani: 'ani@txt.bell.ca' };
  const allTokens = ['tok-ani', 'tok-anju'];
  const allSms = ['ani@txt.bell.ca', 'anju@pcs.rogers.com'];
  assert.deepEqual(
    L.resolveAssigneeTargets('', memberTokens, allTokens, smsGateways, allSms),
    { tokens: allTokens, smsAddresses: allSms }
  );
  assert.deepEqual(
    L.resolveAssigneeTargets(null, memberTokens, allTokens, smsGateways, allSms),
    { tokens: allTokens, smsAddresses: allSms }
  );
});

test('resolveAssigneeTargets: assignee with devices and an SMS gateway gets only their own', () => {
  const memberTokens = { Ani: ['tok-ani'], Anju: ['tok-anju'] };
  const smsGateways = { Ani: 'ani@txt.bell.ca', Anju: 'anju@pcs.rogers.com' };
  const allTokens = ['tok-ani', 'tok-anju'];
  const allSms = ['ani@txt.bell.ca', 'anju@pcs.rogers.com'];
  assert.deepEqual(
    L.resolveAssigneeTargets('Anju', memberTokens, allTokens, smsGateways, allSms),
    { tokens: ['tok-anju'], smsAddresses: ['anju@pcs.rogers.com'] }
  );
});

test('resolveAssigneeTargets falls back to everyone per channel when the assignee has nothing on that channel', () => {
  // Kevin has a push device but no SMS gateway entry.
  const memberTokens = { Kevin: ['tok-kevin'] };
  const smsGateways = {};
  const allTokens = ['tok-kevin', 'tok-rachel'];
  const allSms = ['rachel@txt.bell.ca'];
  assert.deepEqual(
    L.resolveAssigneeTargets('Kevin', memberTokens, allTokens, smsGateways, allSms),
    { tokens: ['tok-kevin'], smsAddresses: allSms } // push: his own; SMS: falls back
  );
  // Rachel has no registered devices at all yet.
  assert.deepEqual(
    L.resolveAssigneeTargets('Rachel', {}, allTokens, { Rachel: 'rachel@txt.bell.ca' }, allSms),
    { tokens: allTokens, smsAddresses: ['rachel@txt.bell.ca'] } // push falls back; SMS: hers
  );
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

test('buildWeeklyDigest summarizes counts, with overdue called out only when present', () => {
  const noOverdue = L.buildWeeklyDigest(
    [{ icon: '📅', title: 'Dentist', date: '2026-11-17' }, { icon: '📅', title: 'Soccer', date: '2026-11-18' }, { icon: '📅', title: 'Haircut', date: '2026-11-19' }],
    [{ icon: '🚗', title: 'Oil change', date: '2026-11-16' }],
    [],
  );
  assert.equal(noOverdue.summary, '📅 This week: 3 appointments, 1 item due');
  assert.equal(noOverdue.hasAny, true);

  const withOverdue = L.buildWeeklyDigest(
    [],
    [],
    [{ icon: '🏡', title: 'Furnace filter', date: '2026-11-10' }],
  );
  assert.equal(withOverdue.summary, '📅 This week: 0 appointments, 0 items due, 1 overdue');
});

test('buildWeeklyDigest pluralizes correctly and lists overdue items first', () => {
  const d = L.buildWeeklyDigest(
    [{ icon: '📅', title: 'Dentist', date: '2026-11-17' }],
    [{ icon: '🚗', title: 'Oil change', date: '2026-11-16' }, { icon: '🏡', title: 'Gutters', date: '2026-11-18' }],
    [{ icon: '🏡', title: 'Furnace filter', date: '2026-11-10' }],
  );
  assert.equal(d.summary, '📅 This week: 1 appointment, 2 items due, 1 overdue');
  assert.deepEqual(d.detailLines, [
    '🏡 Furnace filter — 2026-11-10',
    '📅 Dentist — 2026-11-17',
    '🚗 Oil change — 2026-11-16',
    '🏡 Gutters — 2026-11-18',
  ]);
});

test('buildWeeklyDigest reports hasAny=false and no digest needed when the week is empty', () => {
  const empty = L.buildWeeklyDigest([], [], []);
  assert.equal(empty.hasAny, false);
  assert.equal(empty.summary, '📅 This week: 0 appointments, 0 items due');
});
