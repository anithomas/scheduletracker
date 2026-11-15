/**
 * generate-ics-feeds.js
 * Family Household Tracker — Phase 4, F8: private per-member calendar feed
 *
 * Runs as a build step (see .github/workflows/deploy-pages.yml and
 * ics-feeds.yml) rather than against a live server endpoint: the app is
 * static GitHub Pages (tracker.logicmanse.ca via CNAME), not the Netlify
 * setup the project description mentions, so there's no request-time
 * compute available to generate a feed on demand. Instead this script
 * writes one static .ics file per subscribed member straight into the
 * build output on every deploy *and* on its own short timer, which is
 * close enough to "live" for a calendar app that itself only re-polls a
 * subscribed feed every few hours.
 *
 * Each member's feed filename is their secret token (set via "📅 Calendar
 * Feed" in their profile) — the URL itself is the credential, nothing else
 * gates access to it, matching the proposal's "Feed URL is a secret link".
 * Revoking just clears the token; the next run (deploy or scheduled) stops
 * writing that file, and because actions/deploy-pages replaces the whole
 * site content on every deploy, the old file stops being served within one
 * more deploy cycle.
 *
 * Required environment variables — same Firebase secrets as the other
 * scripts/*.js jobs (see send-reminders.js's header for what each one is):
 *   FIREBASE_SERVICE_ACCOUNT, FIREBASE_PROJECT_ID
 *
 * CLI usage:  node generate-ics-feeds.js <output-dir>
 *   <output-dir> defaults to ../dist/feeds (i.e. the Vite build's output,
 *   so the workflow can run this *after* `vite build` and have the feed
 *   files simply become part of the same deploy).
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { buildCalendar, buildMemberVevents } = require('./ics-builder');

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

admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId });
const db = admin.firestore();

async function main() {
  const outDir = path.resolve(__dirname, process.argv[2] || '../dist/feeds');
  console.log(`\n📅 generate-ics-feeds — ${new Date().toISOString()}`);
  console.log(`  Output: ${outDir}`);

  const configSnap = await db.collection('settings').doc('config').get();
  if (!configSnap.exists) { console.log('ℹ️  No settings/config found — nothing to do'); return; }
  const members = configSnap.data().members || [];

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

  fs.mkdirSync(outDir, { recursive: true });
  // Start clean: a revoked token's old file (or one left from a renamed
  // member) must not keep being served just because this run didn't
  // overwrite it.
  fs.readdirSync(outDir).filter(f => f.endsWith('.ics')).forEach(f => fs.unlinkSync(path.join(outDir, f)));

  const now = new Date();
  let written = 0;
  members.forEach(m => {
    const email = (m.email || '').toLowerCase();
    const token = email && prefsByEmail[email] && prefsByEmail[email].icsFeedToken;
    if (!token) return;
    const veventLines = buildMemberVevents(m.name, events, autoRecords, homeItems, now);
    const calendar = buildCalendar(`${m.name} — Family Tracker`, veventLines);
    fs.writeFileSync(path.join(outDir, `${token}.ics`), calendar, 'utf8');
    console.log(`  ✅ ${m.name}: ${veventLines.length} item(s) → ${token}.ics`);
    written++;
  });

  console.log(`\n✅ Done — ${written} feed(s) written`);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
