/**
 * send-reminders.js
 * Family Household Tracker — Daily push reminder script
 * Runs via GitHub Actions on a daily schedule (see .github/workflows/reminders.yml)
 *
 * What it does:
 *   1. Reads reminderSettings + members (with fcmTokens) from Firestore settings/config
 *   2. Reads autoRecords, homeItems, events collections
 *   3. Finds items within the configured lead-time windows
 *   4. Sends FCM V1 push notifications to registered device tokens
 *
 * Required environment variables (set as GitHub Actions secrets — NEVER in code):
 *   FIREBASE_SERVICE_ACCOUNT  — full JSON of the Firebase service account key
 *   FIREBASE_PROJECT_ID       — Firebase project ID (e.g. home-and-auto-tracker)
 */

const admin = require('firebase-admin');

// ─── Init ──────────────────────────────────────────────────────
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

  // Build a map of member name → FCM tokens (for per-member targeting)
  const memberTokens = {};
  members.forEach(m => {
    if (m.fcmTokens && m.fcmTokens.length) memberTokens[m.name] = m.fcmTokens;
  });

  // Collect all tokens across all members for "all members" notifications
  const allTokens = members.flatMap(m => m.fcmTokens || []).filter(Boolean);
  if (!allTokens.length) { console.log('ℹ️  No device tokens registered — nothing to send'); return; }

  // 2. Fetch collections in parallel
  const [autoSnap, homeSnap, eventsSnap] = await Promise.all([
    db.collection('autoRecords').get(),
    db.collection('homeItems').get(),
    db.collection('events').get(),
  ]);

  const autoRecords = autoSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const homeItems = homeSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const events = eventsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 3. Build reminder list
  const reminders = [];

  events.forEach(e => {
    const d = daysUntil(e.date);
    if (d === null || d < 0 || d > maxDays) return;
    if (!leadTimes.some(lt => d <= lt)) return;

    // Determine who gets notified for this event:
    //   a) Event members (multi-member support: e.members[] or legacy e.member)
    //   b) Members whose notifyTypes includes this event type (subscription)
    //   c) Explicit e.notifyMembers[] overrides
    const evType = (e.type || '').toLowerCase();
    const eventMemberNames = new Set(
      e.members && e.members.length ? e.members : (e.member ? [e.member] : [])
    );

    // Add subscription-based members
    members.forEach(m => {
      const nt = m.notifyTypes || [];
      if (nt.includes('all') || (evType && nt.includes(evType))) {
        eventMemberNames.add(m.name);
      }
    });

    // Add explicit notifyMembers overrides
    if (e.notifyMembers && e.notifyMembers.length) {
      e.notifyMembers.forEach(n => eventMemberNames.add(n));
    }

    // Build token list from the union set
    let tokens = [];
    if (eventMemberNames.size === 0 || (e.reminderRecipients === 'all' && !e.notifyMembers)) {
      tokens = allTokens;
    } else {
      eventMemberNames.forEach(name => {
        const mt = memberTokens[name] || [];
        tokens.push(...mt);
      });
      // Fallback: if no tokens found for named members, send to all
      if (!tokens.length) tokens = allTokens;
    }

    const memberLabel = [...eventMemberNames].join(', ');
    reminders.push({
      icon: '📅',
      title: e.title,
      body: `${dayLabel(d)}${memberLabel ? ' · ' + memberLabel : ''}`,
      tokens,
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
    });
  });

  if (!reminders.length) {
    console.log('✅ No reminders due within lead-time window — done');
    return;
  }

  console.log(`  📋 ${reminders.length} reminder(s) to send`);

  // 4. Send FCM messages
  let sent = 0, failed = 0;
  for (const reminder of reminders) {
    const tokens = [...new Set(reminder.tokens || allTokens)];
    if (!tokens.length) continue;

    const message = {
      notification: {
        title: `${reminder.icon} ${reminder.title}`,
        body: reminder.body,
      },
      webpush: {
        notification: {
          icon: '/icon-192.png',
          badge: '/icon-192.png',
        },
      },
      tokens,
    };

    try {
      const response = await messaging.sendEachForMulticast(message);
      sent += response.successCount;
      failed += response.failureCount;
      if (response.failureCount > 0) {
        response.responses.forEach((r, i) => {
          if (!r.success) console.warn(`  ⚠️  Token ${i} failed: ${r.error?.message}`);
        });
      }
      console.log(`  ✅ "${reminder.title}" → ${response.successCount}/${tokens.length} delivered`);
    } catch (err) {
      console.error(`  ❌ Failed to send "${reminder.title}":`, err.message);
      failed++;
    }
  }

  console.log(`\n✅ Done — ${sent} delivered, ${failed} failed`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
