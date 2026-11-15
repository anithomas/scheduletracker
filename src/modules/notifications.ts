// ─── NOTIFICATIONS / REMINDERS ─────────────────────────────────
import { firebase } from './firebase-init';
import { VAPID_KEY } from '../config';
import { appConfig, appMembers } from './settings';
import { prefsFor, writeMemberPrefs, renderAdminMembers } from './member-prefs';
import { toast } from './utils';
import { getVehicleForRecord } from './vehicles';
import { vehicleDisplayName } from './display-names';
import { CAT_ICONS } from './admin-catalog';
import { esc } from './html-escape';
import { toDs, parseDs, autoRecords, homeItems, events, renewals } from './save-guards';
import { RENEWAL_CAT_ICONS } from './renewals';
import { saveSettings } from './vehicles';

const LEAD_TIME_OPTIONS = [
  {days:1,  label:'1 day before'},
  {days:3,  label:'3 days before'},
  {days:7,  label:'1 week before'},
  {days:14, label:'2 weeks before'},
];
export let messaging: any = null;

// Detect browser/OS details for device registration labels
export function getDeviceInfo() {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera\//.test(ua)) browser = 'Opera';
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  let os = 'Unknown';
  if (/iPhone/.test(ua)) os = 'iPhone';
  else if (/iPad/.test(ua)) os = 'iPad';
  else if (/Android/.test(ua)) {
    const m = ua.match(/Android [0-9.]+;?\s*([^;)]+)/i);
    os = m ? m[1].trim() : 'Android';
    if (os.length > 30) os = 'Android';
  }
  else if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  const icon = /iPhone|iPad|Android|Mobile/.test(ua) ? '📱' : '💻';
  return { browser, os, icon };
}

// Render device list HTML rows (shared by admin modal + my profile modal)
export function _deviceListHTML(tokens: any[], removeCallbackFn: string) {
  if (!tokens || !tokens.length) return '<div style="font-size:.78rem;color:var(--gray-400)">No devices registered yet.</div>';
  return tokens.map((d, i) => {
    const tok = typeof d === 'object' ? d.token : d;
    const icon = (typeof d === 'object' && d.icon) ? d.icon : '📱';
    const label = (typeof d === 'object') ? `${d.browser || 'Browser'} on ${d.os || 'Unknown'}` : `Device ${i+1}`;
    const dateStr = (typeof d === 'object' && d.registeredAt)
      ? new Date(d.registeredAt).toLocaleDateString('en-CA', {month:'short', day:'numeric', year:'numeric'})
      : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--card);border:1px solid var(--gray-200);border-radius:8px;gap:8px">
      <div>
        <div style="font-size:.8rem;font-weight:600;color:var(--gray-700)">${icon} ${label}</div>
        ${dateStr ? `<div style="font-size:.72rem;color:var(--gray-400);margin-top:2px">Registered ${dateStr}</div>` : ''}
      </div>
      <button class="btn btn-sm btn-ghost" style="padding:3px 8px;font-size:.72rem;color:var(--red);flex-shrink:0" data-token="${tok}" onclick="${removeCallbackFn}(this.dataset.token,this)">🗑 Remove</button>
    </div>`;
  }).join('');
}

export function initFCM() {
  try {
    if (!firebase.messaging.isSupported()) return;
    messaging = firebase.messaging();
    messaging.onMessage((payload: any) => {
      const {title, body} = payload.notification || payload.data || {};
      if (title) showBrowserNotification(title, body || '');
    });
  } catch(e) { console.warn('FCM init error', e); }
}

// Admin registers THIS browser's device for a chosen member (who may be the
// admin themself, or someone else being helped at their own device). Writes
// that member's own memberPrefs doc (Phase 2, S1) — never settings/config.
export async function registerDeviceForMember(memberId: string) {
  try {
    if (!messaging) { toast('⚠️ Push notifications not supported in this browser'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { toast('⚠️ Notification permission denied'); return; }
    const swReg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) { toast('⚠️ Could not get device token'); return; }
    const m: any = appMembers.find(x => x.id === memberId);
    if (!m) return;
    if (!m.email) { toast('⚠️ This member has no email on file'); return; }
    const existing = prefsFor(m).fcmTokens;
    if (!existing.some((d: any) => (d.token||d) === token)) {
      const info = getDeviceInfo();
      await writeMemberPrefs(m.email, cur => ({fcmTokens: [...(cur.fcmTokens||[]), {token, browser:info.browser, os:info.os, icon:info.icon, registeredAt:new Date().toISOString()}]}));
      renderAdminMembers();
      toast('✅ Device registered for ' + m.name + '!');
    } else {
      toast('ℹ️ This device is already registered for ' + m.name);
    }
  } catch(e: any) { toast('⚠️ Registration failed: ' + e.message); }
}

export async function unregisterDeviceForMember(memberId: string) {
  try {
    if (!messaging) return;
    const swReg = await navigator.serviceWorker.ready;
    const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    if (!token) return;
    const m: any = appMembers.find(x => x.id === memberId);
    if (!m || !m.email) return;
    await writeMemberPrefs(m.email, cur => ({fcmTokens: (cur.fcmTokens||[]).filter((t: any) => (t.token||t) !== token)}));
    renderAdminMembers();
    toast('🗑 Device unregistered for ' + m.name);
  } catch(e: any) { toast('⚠️ Unregister failed: ' + e.message); }
}

export function renderAdminNotifications() {
  const panel = document.getElementById('notifAdminPanel');
  if (!panel) return;
  const rs: any = appConfig.reminderSettings || {};
  const enabled = rs.enabled !== false;
  const leadTimes = rs.leadTimes || [1, 7];
  const toggle = document.getElementById('cfgReminderEnabled') as HTMLInputElement;
  if (toggle) toggle.checked = enabled;
  // F6: defaults on for anyone who hasn't touched this setting yet — the
  // same "undefined means on" convention `enabled` above already uses.
  const digestToggle = document.getElementById('cfgWeeklyDigestEnabled') as HTMLInputElement;
  if (digestToggle) digestToggle.checked = rs.weeklyDigest?.enabled !== false;
  const ltGrid = document.getElementById('cfgLeadTimes');
  if (ltGrid) {
    ltGrid.innerHTML = LEAD_TIME_OPTIONS.map(opt => `
      <label class="notif-lt-label">
        <input type="checkbox" value="${opt.days}" ${leadTimes.includes(opt.days) ? 'checked' : ''} onchange="saveReminderSettings()" />
        ${opt.label}
      </label>`).join('');
  }
}

export async function saveReminderSettings() {
  const enabled = (document.getElementById('cfgReminderEnabled') as HTMLInputElement)?.checked !== false;
  const leadTimes = Array.from(document.querySelectorAll<HTMLInputElement>('#cfgLeadTimes input:checked')).map(el => parseInt(el.value));
  const weeklyDigestToggle = document.getElementById('cfgWeeklyDigestEnabled') as HTMLInputElement | null;
  const weeklyDigestEnabled = weeklyDigestToggle ? weeklyDigestToggle.checked !== false : true;
  appConfig.reminderSettings = {
    ...(appConfig.reminderSettings || {}),
    enabled,
    leadTimes: leadTimes.length ? leadTimes : [1, 7],
    weeklyDigest: { enabled: weeklyDigestEnabled },
  } as typeof appConfig.reminderSettings;
  await saveSettings();
  const notifSaved = document.getElementById('notifSaved');
  if (notifSaved) notifSaved.textContent = '✅ Saved';
  toast('✅ Reminder settings saved!');
}

export async function showBrowserNotification(title: string, body: string) {
  if (Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png' });
  }
}

export function checkAndShowReminders() {
  const rs: any = appConfig.reminderSettings || {};
  if (rs.enabled === false) return;
  const leadTimes: number[] = rs.leadTimes || [1, 7];
  const maxLeadDays = Math.max(...leadTimes);
  const BANNER_WINDOW = 30; // show all appointments in the next 30 days in the in-app banner
  const now = new Date(); now.setHours(0,0,0,0);
  const todayDsLocal = toDs(now);
  const daysUntilDate = (ds: string | undefined | null) => {
    if (!ds) return null;
    const d = parseDs(ds);
    return Math.round((d.getTime() - now.getTime()) / 86400000);
  };
  const reminders: any[] = [];

  events.forEach(e => {
    if (e.recurringParentId) return; // exception docs handled via parent
    if (e.completed) return;         // done items stop reminding
    let eventDate;
    if (e.recurrence && e.recurrence.type) {
      // Recurring event: use next upcoming occurrence instead of series start date
      eventDate = getNextOccurrence(e, todayDsLocal, BANNER_WINDOW);
      if (!eventDate) return;
    } else {
      eventDate = e.date;
    }
    const d = daysUntilDate(eventDate);
    if (d === null || d < 0 || d > BANNER_WINDOW) return;
    const label = d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
    const isUrgent = leadTimes.some(lt => d <= lt);
    reminders.push({ icon: '📅', title: e.title, label, member: e.member, date: eventDate, urgent: isUrgent });
  });

  // Banner label for a due date: overdue items stay visible (they used to vanish
  // the day after they were due, exactly when they matter most); completed ones don't.
  const dueLabel = (d: number) => d < 0 ? `Overdue by ${-d} day${d === -1 ? '' : 's'}`
                     : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : `Due in ${d} days`;

  autoRecords.forEach(r => {
    if (r.completed) return;
    const d = daysUntilDate(r.nextDate);
    if (d === null || d > maxLeadDays) return;
    if (d < 0 || leadTimes.some(lt => d <= lt)) {
      const veh = getVehicleForRecord(r);
      reminders.push({ icon: '🚗', title: `${r.service}${veh ? ' — ' + vehicleDisplayName(veh) : ''}`, label: dueLabel(d), date: r.nextDate, urgent: true });
    }
  });

  homeItems.forEach(h => {
    if (h.completed) return;
    const d = daysUntilDate(h.nextDate);
    if (d === null || d > maxLeadDays) return;
    if (d < 0 || leadTimes.some(lt => d <= lt)) {
      reminders.push({ icon: CAT_ICONS[h.category] || '🏡', title: h.item, label: dueLabel(d), date: h.nextDate, urgent: true });
    }
  });

  // Renewals (Phase 4, F2) always use a fixed 30/7-day window — the proposal
  // calls for that cadence specifically, independent of whatever lead times
  // the household has configured for auto/home reminders.
  const RENEWAL_LEAD_TIMES = [30, 7];
  const renewalMaxLead = Math.max(...RENEWAL_LEAD_TIMES);
  renewals.forEach(r => {
    if (r.completed) return;
    const d = daysUntilDate(r.nextDate);
    if (d === null || d > renewalMaxLead) return;
    if (d < 0 || RENEWAL_LEAD_TIMES.some(lt => d <= lt)) {
      reminders.push({ icon: RENEWAL_CAT_ICONS[r.category] || '🔖', title: r.title, label: dueLabel(d), date: r.nextDate, urgent: true });
    }
  });

  if (!reminders.length) return;
  reminders.sort((a, b) => (a.date||'').localeCompare(b.date||''));
  showReminderBanner(reminders);
  // Browser notifications: only today/tomorrow (never overdue), and only once per
  // item per day. Before, every Firestore snapshot re-ran this and re-notified.
  if (Notification.permission !== 'granted') return;
  let seen: { day: string; keys: string[] } = { day: todayDsLocal, keys: [] };
  try {
    const stored = JSON.parse(localStorage.getItem('trackerNotified') || 'null');
    if (stored && stored.day === todayDsLocal && Array.isArray(stored.keys)) seen = stored;
  } catch (e) {}
  reminders
    .filter(r => r.urgent && (daysUntilDate(r.date) as number) >= 0 && (daysUntilDate(r.date) as number) <= 1)
    .forEach(r => {
      const key = `${r.icon}|${r.title}|${r.date}`;
      if (seen.keys.includes(key)) return;
      seen.keys.push(key);
      showBrowserNotification(`${r.icon} ${r.title}`, r.label);
    });
  try { localStorage.setItem('trackerNotified', JSON.stringify(seen)); } catch (e) {}
}

export function showReminderBanner(reminders: any[]) {
  const existing = document.getElementById('reminderBanner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'reminderBanner';
  banner.className = 'reminder-banner';
  banner.innerHTML = `
    <div class="reminder-banner-header">
      <span class="reminder-banner-title">🔔 ${reminders.length} Reminder${reminders.length > 1 ? 's' : ''}</span>
      <button class="reminder-dismiss" onclick="document.getElementById('reminderBanner').remove()">✕</button>
    </div>
    <div class="reminder-banner-items">
      ${reminders.slice(0, 5).map(r => `
        <div class="reminder-item">
          <span class="reminder-item-icon">${r.icon}</span>
          <div class="reminder-item-text">
            <span class="reminder-item-title">${esc(r.title)}${r.member ? ` <span class="reminder-item-member">· ${esc(r.member)}</span>` : ''}</span>
            <span class="reminder-item-when">${esc(r.label)}</span>
          </div>
        </div>`).join('')}
      ${reminders.length > 5 ? `<div class="reminder-item-more">+${reminders.length-5} more</div>` : ''}
    </div>`;
  const nav = document.querySelector('nav');
  if (nav) nav.after(banner);
}

export function rebuildReminderRecipientsDropdown() {
  const sel = document.getElementById('cReminderRecipients') as HTMLSelectElement;
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="all">👨‍👩‍👧‍👦 All Members (default)</option>' +
    appMembers.map(m => `<option value="${m.name}">${m.name} only</option>`).join('');
  if (cur) sel.value = cur;
}
