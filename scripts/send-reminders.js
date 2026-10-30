/**
 * send-reminders.js
 * Family Household Tracker — Daily reminder script
 * Runs via GitHub Actions on a daily schedule (see .github/workflows/reminders.yml)
 *
 * What it does:
 *   1. Reads reminderSettings + members (with fcmTokens) from Firestore settings/config
 *   2. Reads autoRecords, homeItems, events collections
 *   3. Finds items within the configured lead-time windows
 *   4. Sends FCM push notifications to registered devices
 *   5. Sends SMS via free carrier email-to-SMS gateways (Bell / Rogers)
 *
 * Required environment variables (set as GitHub Actions secrets — NEVER in code):
 *   FIREBASE_SERVICE_ACCOUNT  — full JSON of the Firebase service account key
 *   FIREBASE_PROJECT_ID       — Firebase project ID (e.g. home-and-auto-tracker)
 *   GMAIL_USER                — Google account email used to send SMS gateway emails
 *   GMAIL_APP_PASSWORD        — Google App Password for the above account
 *   SMS_GATEWAYS_JSON         — {"Member Name":"number@carrier-gateway", ...}
 */

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const {
  daysUntil, shouldRemind, shouldRemindOverdue, dayLabel, isDeadTokenError, removeTokens,
} = require('./reminder-logic');

// ─── SMS Gateway Map ────────────────────────────────────────────
// Free carrier email-to-SMS gateways — messages arrive as real SMS texts
// (Bell: @txt.bell.ca | Rogers: @pcs.rogers.com).
// Phone numbers are personal data and this repo is public, so the map comes
// from the SMS_GATEWAYS_JSON secret:  {"Member Name":"5551234567@txt.bell.ca", ...}
// Keys must match member names as stored in settings/config.
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
  // Deliberately not printing e.message: JSON parse errors can quote part of the
  // secret, and Actions logs on a public repo are public.
  console.error('❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON — re-paste the full key file into the secret');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId,
});

const db = admin.firestore();
const messaging = admin.messaging();

// ─── Nodemailer / SMS Setup ────────────────────────────────────
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.log('ℹ️  GMAIL_USER / GMAIL_APP_PASSWORD not set — SMS disabled');
    return null;
  }
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user, pass },
  });
}

// Actions logs on a public repo are public: never print full phone numbers.
function maskAddr(a) { return String(a).replace(/^(\d{3})\d+(\d{2})@/, '$1*****$2@'); }

async function sendSMS(transporter, toAddresses, subject, text) {
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
      console.log(`  📱 SMS ✅ → ${maskAddr(to)}`);
      sent++;
    } catch (err) {
      console.warn(`  📱 SMS ⚠️  → ${maskAddr(to)}: ${err.message}`);
      failed++;
    }
  }
  return { sent, failed };
}

// ─── Helpers ───────────────────────────────────────────────────
// Dead-token pruning (S4). FCM tells us when a device token is permanently
// invalid (app uninstalled, token rotated); keeping them only grows the list.
// Runs in a transaction so a concurrent Admin-screen save is not overwritten.
async function pruneDeadTokens(dead) {
  if (!dead.size) return;
  const ref = db.collection('settings').doc('config');
  try {
    const removed = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const result = removeTokens((snap.data() || {}).members, dead);
      if (result.removed) tx.update(ref, { members: result.members });
      return result.removed;
    });
    console.log(`  🧹 Pruned ${removed} dead device token(s)`);
  } catch (err) {
    console.warn(`  ⚠️  Could not prune dead tokens: ${err.message}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔔 send-reminders — ${new Date().toISOString()}`);

  // 1. Load settings
  const configSnap = await db.collection('settings').doc('config').get();
  if (!configSnap.exists) { console.log('ℹ️  No settings/config found — nothing to do'); return; }
  const config = configSnap.data();

  const reminderSettings = config.reminderSettings || {};
  if (reminderSettings.enabled === false) { console.log('ℹ️  Reminders disabled — exiting'); return; }

  const leadTimes = reminderSettings.leadTimes || [1, 7];
  const members = config.members || [];

  console.log(`  Lead times: ${leadTimes.join(', ')} days | Members: ${members.length}`);

  // FCM token maps
  const extractTokens = arr => (arr || []).map(d => (typeof d === 'object' ? d.token : d)).filter(Boolean);
  const memberTokens = {};
  members.forEach(m => {
    const toks = extractTokens(m.fcmTokens);
    if (toks.length) memberTokens[m.name] = toks;
  });
  const allTokens = members.flatMap(m => extractTokens(m.fcmTokens));

  // SMS transporter
  const transporter = createTransporter();

  // 2. Fetch collections in parallel
  const [autoSnap, homeSnap, eventsSnap] = await Promise.all([
    db.collection('autoRecords').get(),
    db.collection('homeItems').get(),
    db.collection('events').get(),
  ]);

  const autoRecords = autoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const homeItems   = homeSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const events      = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 3. Build reminder list
  const reminders = [];

  events.forEach(e => {
    if (e.completed) return;
    const d = daysUntil(e.date);
    if (!shouldRemind(d, leadTimes)) return;

    const evType = (e.type || '').toLowerCase();
    const eventMemberNames = new Set(
      e.members && e.members.length ? e.members : (e.member ? [e.member] : [])
    );

    members.forEach(m => {
      const nt = m.notifyTypes || [];
      if (nt.includes('all') || (evType && nt.includes(evType))) eventMemberNames.add(m.name);
    });
    if (e.notifyMembers && e.notifyMembers.length) {
      e.notifyMembers.forEach(n => eventMemberNames.add(n));
    }

    // FCM tokens
    let tokens = [];
    if (eventMemberNames.size === 0 || (e.reminderRecipients === 'all' && !e.notifyMembers)) {
      tokens = allTokens;
    } else {
      eventMemberNames.forEach(name => tokens.push(...(memberTokens[name] || [])));
      if (!tokens.length) tokens = allTokens;
    }

    // SMS addresses — target specific members or all
    let smsAddresses = [];
    if (eventMemberNames.size === 0 || (e.reminderRecipients === 'all' && !e.notifyMembers)) {
      smsAddresses = ALL_SMS_ADDRESSES;
    } else {
      eventMemberNames.forEach(name => {
        if (SMS_GATEWAYS[name]) smsAddresses.push(SMS_GATEWAYS[name]);
      });
      if (!smsAddresses.length) smsAddresses = ALL_SMS_ADDRESSES;
    }

    const memberLabel = [...eventMemberNames].join(', ');
    reminders.push({
      icon: '📅',
      title: e.title,
      body: `${dayLabel(d)}${memberLabel ? ' · ' + memberLabel : ''}`,
      tokens,
      smsAddresses,
    });
  });

  autoRecords.forEach(r => {
    if (r.completed) return;
    const d = daysUntil(r.nextDate);
    if (!shouldRemind(d, leadTimes) && !shouldRemindOverdue(d)) return;
    const vehicle = r.vehicleName || r.vehicle || '';
    reminders.push({
      icon: d < 0 ? '⚠️' : '🚗',
      title: `${r.service}${vehicle ? ' — ' + vehicle : ''}`,
      body: d < 0 ? dayLabel(d) : `Due: ${dayLabel(d)}`,
      tokens: allTokens,
      smsAddresses: ALL_SMS_ADDRESSES,
    });
  });

  homeItems.forEach(h => {
    if (h.completed) return;
    const d = daysUntil(h.nextDate);
    if (!shouldRemind(d, leadTimes) && !shouldRemindOverdue(d)) return;
    reminders.push({
      icon: d < 0 ? '⚠️' : '🏡',
      title: h.item || h.description || 'Home maintenance',
      body: d < 0 ? dayLabel(d) : `Due: ${dayLabel(d)}`,
      tokens: allTokens,
      smsAddresses: ALL_SMS_ADDRESSES,
    });
  });

  if (!reminders.length) {
    console.log('✅ No reminders due within lead-time window — done');
    return;
  }

  console.log(`  📋 ${reminders.length} reminder(s) to send`);

  // 4. Send FCM push + SMS for each reminder
  let fcmSent = 0, fcmFailed = 0, smsSent = 0, smsFailed = 0;
  const deadTokens = new Set();

  for (const reminder of reminders) {
    const subject = `${reminder.icon} ${reminder.title}`;
    const text    = `${subject}\n${reminder.body}\n\n— Thomas Family Tracker`;

    // FCM push (skip if no tokens)
    const tokens = [...new Set(reminder.tokens || [])];
    if (tokens.length) {
      try {
        const resp = await messaging.sendEachForMulticast({
          notification: { title: subject, body: reminder.body },
          webpush: { notification: { icon: '/icon-192.png', badge: '/icon-192.png' } },
          tokens,
        });
        fcmSent   += resp.successCount;
        fcmFailed += resp.failureCount;
        if (resp.failureCount > 0) {
          resp.responses.forEach((r, i) => {
            if (!r.success) {
              console.warn(`  ⚠️  FCM token ${i} failed: ${r.error?.message}`);
              if (isDeadTokenError(r.error?.code)) deadTokens.add(tokens[i]);
            }
          });
        }
        console.log(`  🔔 FCM "${reminder.title}" → ${resp.successCount}/${tokens.length} delivered`);
      } catch (err) {
        console.error(`  ❌ FCM failed "${reminder.title}":`, err.message);
        fcmFailed++;
      }
    }

    // SMS via email-to-carrier gateway
    const smsResult = await sendSMS(transporter, reminder.smsAddresses, subject, text);
    smsSent   += smsResult.sent;
    smsFailed += smsResult.failed;
  }

  await pruneDeadTokens(deadTokens);

  console.log(`\n✅ Done — FCM: ${fcmSent} delivered / ${fcmFailed} failed | SMS: ${smsSent} sent / ${smsFailed} failed`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
