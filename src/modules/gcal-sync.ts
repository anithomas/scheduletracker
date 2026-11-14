// ─── GOOGLE CALENDAR SYNC (Phase 4) ───────────────
// One-way sync: app → Google Calendar
// Ani must complete the Google Cloud Console setup (see CLAUDE.md Phase 4 steps)
// before this feature will work. The GCAL_CLIENT_ID placeholder must be replaced.
import { db } from './firebase-init';
import { GCAL_CLIENT_ID } from '../config';
import { toast } from './utils';
import { events } from './save-guards';

let _gcalTokenClient: any = null;
let _pendingGCalEventId: string | null = null;

export function syncToGCal(eventId: string) {
  if (!GCAL_CLIENT_ID || GCAL_CLIENT_ID.startsWith('YOUR_')) {
    toast('⚙️ Google Calendar not configured yet — see Admin → Google Calendar Setup');
    return;
  }
  const e = events.find(x => x.id === eventId);
  if (!e) return;
  _pendingGCalEventId = eventId;

  if (!_gcalTokenClient) {
    // Lazy-init the token client
    if (typeof google === 'undefined' || !google.accounts) {
      toast('❌ Google Identity Services not loaded');
      return;
    }
    _gcalTokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GCAL_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      callback: _onGCalToken,
    });
  }
  // Request token; if already granted it returns immediately without UI
  _gcalTokenClient.requestAccessToken({ prompt: '' });
}

function _onGCalToken(response: any) {
  if (response.error || !response.access_token) {
    toast('❌ Google auth failed: ' + (response.error || 'no token'));
    _pendingGCalEventId = null;
    return;
  }
  const e = events.find(x => x.id === _pendingGCalEventId);
  _pendingGCalEventId = null;
  if (!e) return;
  _doSyncToGCal(e, response.access_token);
}

async function _doSyncToGCal(e: any, token: string) {
  // Build start/end in Google Calendar format
  const hasTime  = !!e.time;
  const tz       = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Toronto';
  const startStr = e.date + (hasTime ? `T${e.time}:00` : '');
  // End: 1 hour after start if timed; otherwise next day if single-day
  let endStr: string;
  if (hasTime) {
    const [hh, mm] = e.time.split(':').map(Number);
    const endH = String(hh + 1).padStart(2, '0');
    endStr = e.date + `T${endH}:${String(mm).padStart(2,'0')}:00`;
  } else {
    const endD = new Date((e.endDate || e.date) + 'T00:00:00');
    endD.setDate(endD.getDate() + 1); // GCal all-day end is exclusive
    endStr = endD.toISOString().slice(0, 10);
  }

  const body = {
    summary:     e.title,
    description: [e.notes || '', e.member ? `Member: ${e.member}` : ''].filter(Boolean).join('\n'),
    location:    e.location || '',
    start: hasTime ? { dateTime: startStr, timeZone: tz } : { date: startStr },
    end:   hasTime ? { dateTime: endStr,   timeZone: tz } : { date: endStr },
  };

  const gcalId = e.gcalEventId;
  const url    = gcalId
    ? `https://www.googleapis.com/calendar/v3/calendars/primary/events/${gcalId}`
    : `https://www.googleapis.com/calendar/v3/calendars/primary/events`;
  const method = gcalId ? 'PUT' : 'POST';

  try {
    const res  = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.id) {
      // Persist the Google Calendar event ID so future syncs do a PUT (update) not POST
      await db.collection('events').doc(e.id).update({ gcalEventId: data.id });
      toast('📆 Synced to Google Calendar!');
    } else {
      console.error('GCal API error:', data);
      toast('❌ Sync failed: ' + (data.error?.message || 'Check console'));
    }
  } catch (err: any) {
    console.error('GCal sync error:', err);
    toast('❌ Sync error: ' + err.message);
  }
}
