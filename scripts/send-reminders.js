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
 */

const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// ─── SMS Gateway Map ────────────────────────────────────────────
// Free carrier email-to-SMS gateways — messages arrive as real SMS texts
// Bell: @txt.bell.ca | Rogers: @pcs.rogers.com
const SMS_GATEWAYS = {
  'ANI P Thomas':  '4169034893@txt.bell.ca',
  'ANJU THOMAS':   '4169026311@pcs.rogers.com',
  'Kevin Thomas':  '6475123657@txt.bell.ca',
  'Rachel Thomas': '4375539312@txt.bell.ca',
};
const ALL_SMS_ADDRESSES = Object.values(SMS_GATEWAYS);

// ─── Firebase Init ─────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = process.env.FIREBASE_PROJECT_ID;

if (!serviceAccount || !projectId) {
  console.error('❌ Missing FIREBASE_SERVICE_ACCOUNT or FIREBASE_PROJECT_ID env vars');
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
      console.log(`  📱 SMS ✅ → ${to}`);
      sent++;
    } catch (err) {
      console.warn(`  📱 SMS ⚠️  → ${to}: ${err.message}`);
      failed++;
    }
  }
  return { sent, failed };
}

// ─── Helpers ───────────────────────────────────────────────────
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function dayLabel(d) {
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
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
  const maxDays = Math.max(...leadTimes);
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
    const d = daysUntil(e.date);
    if (d === null || d < 0 || d > maxDays) return;
    if (!leadTimes.some(lt => d <= lt)) return;

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
    const d = daysUntil(r.nextDate);
    if (d === null || d < 0 || d > maxDays) return;
    if (!leadTimes.some(lt => d <= lt)) return;
    const vehicle = r.vehicleName || r.vehicle || '';
    reminders.push({
      icon: '🚗',
      title: `${r.service}${vehicle ? ' — ' + vehicle : ''}`,
      body: `Due: ${dayLabel(d)}`,
      tokens: allTokens,
      smsAddresses: ALL_SMS_ADDRESSES,
    });
  });

  homeItems.forEach(h => {
    const d = daysUntil(h.nextDate);
    if (d === null || d < 0 || d > maxDays) return;
    if (!leadTimes.some(lt => d <= lt)) return;
    reminders.push({
      icon: '🏡',
      title: h.item || h.description || 'Home maintenance',
      body: `Due: ${dayLabel(d)}`,
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
            if (!r.success) console.warn(`  ⚠️  FCM token ${i} failed: ${r.error?.message}`);
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

  console.log(`\n✅ Done — FCM: ${fcmSent} delivered / ${fcmFailed} failed | SMS: ${smsSent} sent / ${smsFailed} failed`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
