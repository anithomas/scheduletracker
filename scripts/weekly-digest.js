/**
 * weekly-digest.js
 * Family Household Tracker — Phase 4, F6: Sunday weekly digest
 * Runs via GitHub Actions on a weekly schedule (see .github/workflows/weekly-digest.yml)
 *
 * What it does:
 *   1. Reads reminderSettings + members (with fcmTokens) from Firestore settings/config
 *   2. Reads autoRecords, homeItems, events collections
 *   3. Builds three buckets for the coming week: appointments, items due soon,
 *      and anything already overdue
 *   4. Sends ONE push notification + ONE email/SMS summarizing all of it,
 *      instead of a pile of individual day-of/lead-time pings
 *
 * This is deliberately a separate script from send-reminders.js rather than
 * a mode flag on it: the two run on independent schedules (daily vs. weekly
 * Sunday), and keeping them separate means a change to one's cadence or
 * targeting logic can't accidentally affect the other.
 *
 * Required environment variables — same secrets as send-reminders.js (see
 * that file's header for what each one is; never put these in code):
 *   FIREBASE_SERVICE_ACCOUNT, FIREBASE_PROJECT_ID, GMAIL_USER,
 *   GMAIL_APP_PASSWORD, SMS_GATEWAYS_JSON
 */

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { daysUntil, torontoDatePlusDays, buildWeeklyDigest } = require('./reminder-logic');
// Shared with index.html and send-reminders.js: same recurrence rules
// everywhere, so the digest's "appointments this week" bucket agrees with
// what the calendar itself shows as upcoming.
const { isRecurringOnDay, exceptionOverrideDates } = require('../recurrence');

function loadSmsGateways() {
  const raw = process.env.SMS_GATEWAYS_JSON;
  if (!raw) { console.log('ℹ️  SMS_GATEWAYS_JSON not set — SMS disabled'); return {}; }
  try {
    const map = JSON.parse(raw);
    if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('not an object');
    return map;
  } catch (e) {
    console.error('⚠️  SMS_GATEWAYS_JSON is not valid JSON (' + e.message + ') — SMS disabled');
    return {};
  }
}
const SMS_GATEWAYS = loadSmsGateways();
const ALL_SMS_ADDRESSES = Object.values(SMS_GATEWAYS);

// ─── Firebase Init ─────────────────────────────────────────────
const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!rawServiceAccount || !projectId) {
  console.error('❌ Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID env vars');
  process.exit(1);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(rawServiceAccount);
} catch (e) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON — re-paste the full key file into the secret');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId,
});

const db = admin.firestore();
const messaging = admin.messaging();

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log('ℹ️  GMAIL_USER / GMAIL_APP_PASSWORD not set — SMS/email disabled');
    return null;
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
}

function maskAddr(a) { return String(a).replace(/^(\d{3})\d+(\d{2})@/, '$1*****$2@'); }

async function sendEmailOrSms(transporter, toAddresses, subject, text) {
  if (!transporter || !toAddresses.length) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  for (const to of toAddresses) {
    try {
      await transporter.sendMail({
        from: `"Family Tracker" <${process.env.GMAIL_USER}>`,
        to,
        subject,
        text,
      });
      console.log(`  📱 ✅ → ${maskAddr(to)}`);
      sent++;
    } catch (err) {
      console.warn(`  📱 ⚠️  → ${maskAddr(to)}: ${err.message}`);
      failed++;
    }
  }
  return { sent, failed };
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n📅 weekly-digest — ${new Date().toISOString()}`);

  const configSnap = await db.collection('settings').doc('config').get();
  if (!configSnap.exists) { console.log('ℹ️  No settings/config found — nothing to do'); return; }
  const config = configSnap.data();

  const reminderSettings = config.reminderSettings || {};
  // Independent opt-out from the daily reminders themselves: a household
  // that wants the Sunday roundup but not day-of pings (or vice versa)
  // shouldn't have to choose one setting for both.
  if (reminderSettings.enabled === false || reminderSettings.weeklyDigest?.enabled === false) {
    console.log('ℹ️  Weekly digest disabled — exiting');
    return;
  }

  const rawMembers = config.members || [];

  const [autoSnap, homeSnap, eventsSnap, prefsSnap] = await Promise.all([
    db.collection('autoRecords').get(),
    db.collection('homeItems').get(),
    db.collection('events').get(),
    db.collection('memberPrefs').get(),
  ]);

  const autoRecords = autoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const homeItems   = homeSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const events      = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const prefsByEmail = {};
  prefsSnap.docs.forEach(d => { prefsByEmail[d.id] = d.data(); });
  const members = rawMembers.map(m => {
    const email = (m.email || '').toLowerCase();
    const prefs = email ? prefsByEmail[email] : null;
    return prefs ? { ...m, fcmTokens: prefs.fcmTokens || [], notifyTypes: prefs.notifyTypes || [] } : m;
  });

  const extractTokens = arr => (arr || []).map(d => (typeof d === 'object' ? d.token : d)).filter(Boolean);
  const allTokens = members.flatMap(m => extractTokens(m.fcmTokens));

  const transporter = createTransporter();

  // ── Appointments: every occurrence (recurring or one-off) landing in the
  // next 7 days, today included — same window the Calendar's "This week"
  // framing implies, and the same per-day recurrence check send-reminders.js
  // uses, just swept across a week of offsets instead of the lead-time list.
  const appointments = [];
  const WEEK_OFFSETS = [0, 1, 2, 3, 4, 5, 6];

  events.forEach(e => {
    if (e.completed || e.recurringParentId) return; // exception docs handled below
    if (!e.recurrence || !e.recurrence.type) return;
    const overrides = exceptionOverrideDates(e.id, events);
    WEEK_OFFSETS.forEach(d => {
      const ds = torontoDatePlusDays(d);
      if (ds === null || overrides.has(ds)) return;
      if (!isRecurringOnDay(e, ds)) return;
      appointments.push({ icon: '📅', title: e.title, date: ds, _sortDate: ds });
    });
  });

  events.forEach(e => {
    if (e.completed) return;
    if (e.recurrence && e.recurrence.type) return; // handled above
    const d = daysUntil(e.date);
    if (d === null || d < 0 || d > 6) return;
    appointments.push({ icon: '📅', title: e.title, date: e.date, _sortDate: e.date });
  });

  // ── Auto / home items: due within the week, or already overdue. Overdue
  // here means simply "d < 0 right now" — unlike shouldRemindOverdue(), the
  // digest isn't throttling a recurring nag, it's reporting current state
  // once a week, so every overdue item belongs in it every Sunday.
  const dueSoon = [];
  const overdue = [];

  autoRecords.forEach(r => {
    if (r.completed) return;
    const d = daysUntil(r.nextDate);
    if (d === null) return;
    const vehicle = r.vehicleName || r.vehicle || '';
    const title = `${r.service}${vehicle ? ' — ' + vehicle : ''}`;
    if (d < 0) overdue.push({ icon: '🚗', title, date: r.nextDate, _sortDate: r.nextDate });
    else if (d <= 6) dueSoon.push({ icon: '🚗', title, date: r.nextDate, _sortDate: r.nextDate });
  });

  homeItems.forEach(h => {
    if (h.completed) return;
    const d = daysUntil(h.nextDate);
    if (d === null) return;
    const title = h.item || h.description || 'Home maintenance';
    if (d < 0) overdue.push({ icon: '🏡', title, date: h.nextDate, _sortDate: h.nextDate });
    else if (d <= 6) dueSoon.push({ icon: '🏡', title, date: h.nextDate, _sortDate: h.nextDate });
  });

  const sortByDate = (a, b) => (a._sortDate || '').localeCompare(b._sortDate || '');
  appointments.sort(sortByDate);
  dueSoon.sort(sortByDate);
  overdue.sort(sortByDate);

  const digest = buildWeeklyDigest(appointments, dueSoon, overdue);
  if (!digest.hasAny) {
    console.log('✅ Nothing on the calendar or due this week — skipping digest');
    return;
  }

  console.log(`  ${digest.summary}`);
  digest.detailLines.forEach(l => console.log(`    ${l}`));

  const subject = digest.summary;
  const emailBody = `${digest.summary}\n\n${digest.detailLines.join('\n')}\n\n— Thomas Family Tracker`;

  let fcmSent = 0, fcmFailed = 0;
  const tokens = [...new Set(allTokens)];
  if (tokens.length) {
    try {
      const resp = await messaging.sendEachForMulticast({
        notification: { title: '📅 Weekly Digest', body: digest.summary },
        webpush: { notification: { icon: '/icon-192.png', badge: '/icon-192.png' } },
        tokens,
      });
      fcmSent = resp.successCount;
      fcmFailed = resp.failureCount;
      console.log(`  🔔 FCM → ${resp.successCount}/${tokens.length} delivered`);
      // Dead-token pruning is intentionally left to the daily send-reminders.js
      // job — a token dead here will surface and get pruned there too, and
      // duplicating that transaction-per-member logic in a second weekly
      // script isn't worth the upkeep for a cleanup that already happens daily.
    } catch (err) {
      console.error('  ❌ FCM failed:', err.message);
      fcmFailed = tokens.length;
    }
  }

  const smsResult = await sendEmailOrSms(transporter, ALL_SMS_ADDRESSES, subject, emailBody);

  console.log(`\n✅ Done — FCM: ${fcmSent} delivered / ${fcmFailed} failed | SMS: ${smsResult.sent} sent / ${smsResult.failed} failed`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
