// ─── REAL-TIME LISTENERS ──────────────────────────────────────
import { db } from './firebase-init';
import { unsubs, setUnsubs, setAutoRecords, setHomeItems, setEvents } from './save-guards';
import { renderAuto } from './auto';
import { renderHome } from './home';
import { renderCalendar } from './calendar';
import { renderSummary } from './reports';
import { checkAndShowReminders, initFCM } from './notifications';
import { applyIncomingSettings } from './vehicles';
import { startPrefsListener } from './member-prefs';

export function startListeners() {
  // Detach any existing listeners first. onAuthStateChanged can fire again for the
  // same user (silent token refresh), which would otherwise stack duplicate
  // onSnapshot subscriptions — causing double renders and repeat notifications.
  unsubs.forEach(u => { try { u(); } catch(e){} });
  setUnsubs([]);
  setSyncStatus('connecting');
  // Run the reminder check ONCE, after all three collections have delivered their
  // first snapshot. The old counter kept incrementing, so every later edit by
  // anyone re-popped the banner and re-fired browser notifications. Day rollover
  // is handled separately (refreshToday -> rerenderAll).
  const firstLoad = new Set();
  const maybeCheckReminders = (name: string) => {
    if (firstLoad.has(name)) return;
    firstLoad.add(name);
    if (firstLoad.size === 3) checkAndShowReminders();
  };
  // A failed listener used to leave the badge on "Live" with silently stale data.
  const onListenError = (name: string) => (err: any) => {
    console.warn(`Firestore listener "${name}" failed:`, err && err.code, err && err.message);
    setSyncStatus('offline');
  };
  unsubs.push(db.collection('autoRecords').orderBy('lastDate','desc').onSnapshot(s=>{
    setAutoRecords(s.docs.map(d=>({id:d.id,...d.data()})));
    renderAuto(); renderSummary(); setSyncStatus('live'); maybeCheckReminders('autoRecords');
  }, onListenError('autoRecords')));
  unsubs.push(db.collection('homeItems').orderBy('nextDate','asc').onSnapshot(s=>{
    setHomeItems(s.docs.map(d=>({id:d.id,...d.data()})));
    renderHome(); renderSummary(); maybeCheckReminders('homeItems');
  }, onListenError('homeItems')));
  unsubs.push(db.collection('events').orderBy('date','asc').onSnapshot(s=>{
    setEvents(s.docs.map(d=>({id:d.id,...d.data()})));
    renderCalendar(); renderSummary(); maybeCheckReminders('events');
  }, onListenError('events')));
  unsubs.push(db.collection('settings').doc('config').onSnapshot(snap=>{
    if(snap.exists) applyIncomingSettings(snap.data());
  }, onListenError('settings')));
  unsubs.push(startPrefsListener());
  initFCM();
}

export function setSyncStatus(s: string) {
  const dot=document.getElementById('syncDot')!, txt=document.getElementById('syncStatus')!;
  dot.className='sync-dot '+s;
  txt.textContent = s==='live'?'Live':s==='connecting'?'Syncing':'Offline';
}
