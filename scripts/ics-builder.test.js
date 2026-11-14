'use strict';
// Run with:  node --test scripts/
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('./ics-builder');

test('escapeText escapes backslash, semicolon, comma and newline in RFC 5545 order', () => {
  assert.equal(I.escapeText('a;b,c\\d\ne'), 'a\\;b\\,c\\\\d\\ne');
  assert.equal(I.escapeText(''), '');
  assert.equal(I.escapeText(null), '');
  assert.equal(I.escapeText(undefined), '');
});

test('foldLine leaves short lines alone and folds long ones at 75 chars with a leading space', () => {
  const short = 'SUMMARY:Dentist';
  assert.equal(I.foldLine(short), short);
  const long = 'SUMMARY:' + 'x'.repeat(100);
  const folded = I.foldLine(long);
  const segments = folded.split('\r\n');
  assert.equal(segments.length, 2);
  assert.equal(segments[0].length, 75);
  assert.equal(segments[1][0], ' ');
  assert.equal(segments[0] + segments[1].slice(1), long);
});

test('toIcsDate and toIcsDateTime format correctly', () => {
  assert.equal(I.toIcsDate('2026-11-17'), '20261117');
  assert.equal(I.toIcsDate(''), '');
  assert.equal(I.toIcsDateTime('2026-11-17', '09:30'), '20261117T093000');
  assert.equal(I.toIcsDateTime('2026-11-17', ''), '20261117T000000');
  assert.equal(I.toIcsDateTime('2026-11-17'), '20261117T000000');
});

test('nowStamp formats a UTC timestamp and accepts an injected clock', () => {
  const fixed = new Date('2026-11-14T23:15:05Z');
  assert.equal(I.nowStamp(fixed), '20261114T231505Z');
});

test('buildRRule covers each recurrence type, interval, weekly BYDAY, and UNTIL', () => {
  assert.equal(I.buildRRule({ type: 'daily' }), 'FREQ=DAILY');
  assert.equal(I.buildRRule({ type: 'daily', interval: 3 }), 'FREQ=DAILY;INTERVAL=3');
  assert.equal(I.buildRRule({ type: 'weekly', daysOfWeek: [1, 3, 5] }), 'FREQ=WEEKLY;BYDAY=MO,WE,FR');
  assert.equal(I.buildRRule({ type: 'weekly', interval: 2, daysOfWeek: [0] }), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU');
  assert.equal(I.buildRRule({ type: 'monthly' }), 'FREQ=MONTHLY');
  assert.equal(I.buildRRule({ type: 'yearly', interval: 1 }), 'FREQ=YEARLY');
  assert.equal(I.buildRRule({ type: 'yearly', endDate: '2030-06-01' }), 'FREQ=YEARLY;UNTIL=20300601T235959Z');
  assert.equal(I.buildRRule(null), null);
  assert.equal(I.buildRRule({}), null);
  assert.equal(I.buildRRule({ type: 'bogus' }), null);
});

test('buildExdateLine joins multiple exception dates, or returns null when none', () => {
  assert.equal(I.buildExdateLine({ exceptions: ['2026-12-25', '2027-01-01'] }), 'EXDATE;VALUE=DATE:20261225,20270101');
  assert.equal(I.buildExdateLine({ exceptions: [] }), null);
  assert.equal(I.buildExdateLine({}), null);
  assert.equal(I.buildExdateLine(null), null);
});

test('buildVevent builds an all-day one-off event', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const lines = I.buildVevent({ uid: 'auto-123', summary: 'Oil change', ds: '2026-11-20', allDay: true, now });
  assert.deepEqual(lines, [
    'BEGIN:VEVENT',
    'UID:auto-123',
    'DTSTAMP:20261114T120000Z',
    'DTSTART;VALUE=DATE:20261120',
    'SUMMARY:Oil change',
    'END:VEVENT',
  ]);
});

test('buildVevent builds a timed recurring series with RRULE and EXDATE', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const lines = I.buildVevent({
    uid: 'evt-1', summary: 'Soccer practice', location: 'Community Centre',
    ds: '2026-09-01', time: '17:30', allDay: false,
    rrule: 'FREQ=WEEKLY;BYDAY=TU', exdateLine: 'EXDATE;VALUE=DATE:20261225', now,
  });
  assert.deepEqual(lines, [
    'BEGIN:VEVENT',
    'UID:evt-1',
    'DTSTAMP:20261114T120000Z',
    'DTSTART:20260901T173000',
    'SUMMARY:Soccer practice',
    'LOCATION:Community Centre',
    'RRULE:FREQ=WEEKLY;BYDAY=TU',
    'EXDATE;VALUE=DATE:20261225',
    'END:VEVENT',
  ]);
});

test('buildVevent builds a RECURRENCE-ID override matching the series\' all-day/timed value type', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const allDay = I.buildVevent({ uid: 'evt-1-ex', summary: 'Soccer practice (moved)', ds: '2026-11-19', allDay: true, recurrenceIdDs: '2026-11-18', now });
  assert.ok(allDay.includes('RECURRENCE-ID;VALUE=DATE:20261118'));
  const timed = I.buildVevent({ uid: 'evt-2-ex', summary: 'Dentist (moved)', ds: '2026-11-19', time: '10:00', allDay: false, recurrenceIdDs: '2026-11-18', now });
  assert.ok(timed.includes('RECURRENCE-ID:20261118T100000'));
});

test('buildCalendar wraps VEVENTs in a VCALENDAR with the expected headers and CRLF line endings', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const vevent = I.buildVevent({ uid: 'auto-1', summary: 'Oil change', ds: '2026-11-20', allDay: true, now });
  const cal = I.buildCalendar("Ani's Feed", [vevent]);
  assert.ok(cal.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(cal.includes('X-WR-CALNAME:Ani\'s Feed'));
  assert.ok(cal.includes('BEGIN:VEVENT\r\nUID:auto-1\r\n'));
  assert.ok(cal.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(cal.endsWith('\r\n'));
});

test('buildCalendar folds a long SUMMARY line in the final output', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const longTitle = 'A'.repeat(90);
  const vevent = I.buildVevent({ uid: 'evt-long', summary: longTitle, ds: '2026-11-20', allDay: true, now });
  const cal = I.buildCalendar('Feed', [vevent]);
  assert.ok(cal.includes('SUMMARY:' + 'A'.repeat(67) + '\r\n ' + 'A'.repeat(23)));
});

test('eventVisibleTo: a shared event (no member/members) is visible to everyone', () => {
  assert.equal(I.eventVisibleTo({}, 'Ani'), true);
  assert.equal(I.eventVisibleTo({ member: '' }, 'Ani'), true);
});

test('eventVisibleTo: a named event is visible only to the named member(s)', () => {
  assert.equal(I.eventVisibleTo({ member: 'Ani' }, 'Ani'), true);
  assert.equal(I.eventVisibleTo({ member: 'Anju' }, 'Ani'), false);
  assert.equal(I.eventVisibleTo({ members: ['Ani', 'Kevin'] }, 'Kevin'), true);
  assert.equal(I.eventVisibleTo({ members: ['Ani', 'Kevin'] }, 'Rachel'), false);
});

test('itemVisibleTo: unassigned is shared, assigned is exclusive', () => {
  assert.equal(I.itemVisibleTo({}, 'Ani'), true);
  assert.equal(I.itemVisibleTo({ assignedTo: '' }, 'Ani'), true);
  assert.equal(I.itemVisibleTo({ assignedTo: 'Ani' }, 'Ani'), true);
  assert.equal(I.itemVisibleTo({ assignedTo: 'Anju' }, 'Ani'), false);
});

test('buildMemberVevents includes shared and own-assigned items, excludes others\' and completed ones', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const events = [
    { id: 'e1', title: 'Family dinner', date: '2026-11-20' }, // shared
    { id: 'e2', title: 'Ani dentist', date: '2026-11-21', member: 'Ani' },
    { id: 'e3', title: 'Anju dentist', date: '2026-11-21', member: 'Anju' },
    { id: 'e4', title: 'Done thing', date: '2026-11-10', member: 'Ani', completed: true },
  ];
  const autoRecords = [
    { id: 'a1', service: 'Oil change', vehicle: 'Civic', nextDate: '2026-11-25' }, // shared
    { id: 'a2', service: 'Brakes', nextDate: '2026-11-26', assignedTo: 'Ani' },
    { id: 'a3', service: 'Tires', nextDate: '2026-11-27', assignedTo: 'Anju' },
    { id: 'a4', service: 'Done', nextDate: '2026-11-01', assignedTo: 'Ani', completed: true },
  ];
  const homeItems = [
    { id: 'h1', item: 'Furnace filter', nextDate: '2026-11-28' }, // shared
    { id: 'h2', item: 'Gutters', nextDate: '2026-11-29', assignedTo: 'Anju' },
  ];
  const lines = I.buildMemberVevents('Ani', events, autoRecords, homeItems, now);
  const uids = lines.map(vevent => vevent.find(l => l.startsWith('UID:')));
  assert.deepEqual(uids, ['UID:evt-e1', 'UID:evt-e2', 'UID:auto-a1', 'UID:auto-a2', 'UID:home-h1']);
});

test('buildMemberVevents emits RECURRENCE-ID overrides sharing the parent series\' UID', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const events = [
    { id: 'e1', title: 'Soccer', date: '2026-09-01', recurrence: { type: 'weekly', daysOfWeek: [2] } },
    { id: 'e1-ex', recurringParentId: 'e1', exceptionDate: '2026-11-17', date: '2026-11-18', title: 'Soccer (moved)' },
  ];
  const lines = I.buildMemberVevents('Ani', events, [], [], now);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('UID:evt-e1'));
  assert.ok(lines[0].some(l => l.startsWith('RRULE:')));
  assert.ok(lines[1].includes('UID:evt-e1')); // same UID as the series it overrides
  assert.ok(lines[1].some(l => l.startsWith('RECURRENCE-ID')));
});
