// ─── CALENDAR ──────────────────────────────────────

// getNextOccurrence() and isRecurringOnDay() now come from recurrence.js
// (loaded as a plain <script> above this one, Phase 2 B3) — the same file
// scripts/send-reminders.js requires server-side, so the calendar and the
// daily reminder job can never disagree about which day a recurring event
// falls on.
import { db, auth, firebase } from './firebase-init';
import { esc, escJs } from './html-escape';
import { toast, fmtTime, statusBadge, fmt, memberColor, memberLabel } from './utils';
import { events, calYear, calMonth, NOW, TODAY, setCalYear, setCalMonth, toDs, beginSave, endSave, withTimeout, friendlyError } from './save-guards';
import { buildEventMemberPicker, getEventSelectedMembers, getEventNotifyMembers } from './member-prefs';
import { openModal, closeModal } from './modal';

export function eventsOnDay(ds: string) {
  const result: any[] = [];
  events.forEach(e => {
    // Skip exception docs here — they're handled in the second pass
    if (e.recurringParentId) return;

    if (e.recurrence && e.recurrence.type) {
      // Recurring series: check if this date matches the pattern
      if (!isRecurringOnDay(e, ds)) return;
      // Skip if a standalone exception event exists for this date
      const hasException = events.some(ex => ex.recurringParentId === e.id && ex.exceptionDate === ds);
      if (hasException) return;
      // Push a virtual instance (not a Firestore doc — clone with extra flags)
      result.push({ ...e, _instanceDate: ds, _isRecurringInstance: true });
    } else {
      // Regular one-off or date-range event
      const start = e.date || '';
      const end   = e.endDate || e.date || '';
      if (start && ds >= start && ds <= end) result.push(e);
    }
  });
  // Second pass: add exception events that land on this date
  events.forEach(e => {
    if (e.recurringParentId && e.date === ds) result.push(e);
  });
  return result;
}

export function renderCalendar(){
  const first=new Date(calYear,calMonth,1);
  const last=new Date(calYear,calMonth+1,0);
  document.getElementById('calTitle')!.textContent=
    first.toLocaleString('en-CA',{month:'long',year:'numeric'});
  let html=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(n=>`<div class="cal-day-name">${n}</div>`).join('');
  for(let i=0;i<first.getDay();i++) html+=`<div class="cal-day other-month"></div>`;
  const todayStr=toDs(TODAY);
  for(let d=1;d<=last.getDate();d++){
    const ds=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday=ds===todayStr;
    const isPast=ds<todayStr;
    const dayEvts=eventsOnDay(ds);
    const eMembers=(e: any)=>e.members&&e.members.length?e.members:(e.member?[e.member]:[]);
    const mClass=(e: any)=>'m-'+(eMembers(e)[0]||'other').toLowerCase().replace(/\s+/g,'');
    const mColor=(e: any)=>memberColor(eMembers(e)[0]);
    const isRange=(e: any)=>e.endDate && e.endDate !== e.date;
    const shown=dayEvts.slice(0,3);
    const hidden=dayEvts.slice(3);
    const tooltipRows=dayEvts.map(e=>{
      const mems=eMembers(e);
      const dots=mems.map((m: string)=>`<span class="cal-tooltip-dot" style="background:${memberColor(m)}"></span>`).join('');
      return `<div class="cal-tooltip-row">${dots}<span><strong>${e.time?fmtTime(e.time)+' ':''}</strong>${esc(e.title)}${isRange(e)?' 📅':''}${mems.length?' · '+esc(mems.join(', ')):''}</span></div>`;
    }).join('');
    const inRange=dayEvts.some(e=>isRange(e)&&ds>e.date&&ds<=(e.endDate||e.date));
    html+=`<div class="cal-day${isToday?' today':''}${isPast&&!isToday?' past-day':''}${inRange?' in-range':''}" onclick="openCalDay('${ds}')">
      <span class="day-num">${d}</span>
      ${shown.map(e=>{
        const isStart=ds===e.date;
        const isEnd=ds===(e.endDate||e.date);
        const rangeClass=isRange(e)?(isStart&&isEnd?'':isStart?'range-start':isEnd?'range-end':'range-mid'):'';
        const instDate = e._isRecurringInstance ? e._instanceDate : '';
        const mems=eMembers(e);
        // For multi-member: show a gradient-like bar using first member color, with tiny dots for extras
        const extraDots=mems.slice(1).map((m: string)=>`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${memberColor(m)};margin-left:2px;vertical-align:middle;border:1px solid rgba(255,255,255,.7)"></span>`).join('');
        const isEventPast=(e.endDate||e.date)<todayStr;
        return `<div class="cal-event ${mClass(e)} ${rangeClass}${isEventPast?' past-event':''}" style="--c:${mColor(e)};cursor:pointer" onclick="event.stopPropagation();editEvent('${escJs(e.id)}','${escJs(instDate)}')">${e.recurrence&&e.recurrence.type?'🔁 ':''}${isStart&&e.time?fmtTime(e.time)+' ':''}${esc(e.title)}${extraDots}</div>`;
      }).join('')}
      ${hidden.length?`<div class="more-events">+${hidden.length} more…</div>`:''}
      ${dayEvts.length?`<div class="cal-tooltip">${tooltipRows}</div>`:''}
    </div>`;
  }
  const endDay=last.getDay();
  for(let i=endDay+1;i<7;i++) html+=`<div class="cal-day other-month"></div>`;
  document.getElementById('calGrid')!.innerHTML=html;

  // Build upcoming list — includes recurring events (using next occurrence) and one-off events
  const _upYest = new Date(); _upYest.setHours(0,0,0,0); _upYest.setDate(_upYest.getDate()-1);
  const _upYestDs = toDs(_upYest);
  const _upTodayDs = new Date(); _upTodayDs.setHours(0,0,0,0); const _upTDs = toDs(_upTodayDs);
  const _upItems: any[] = [];
  events.forEach(e => {
    if (e.recurringParentId) {
      if (e.date && e.date >= _upYestDs) _upItems.push({...e, _displayDate: e.date});
      return;
    }
    if (e.recurrence && e.recurrence.type) {
      // Yearly events (birthdays, anniversaries) can be up to ~365 days out;
      // a 90-day window would make them vanish from "Upcoming" most of the year.
      const lookahead = e.recurrence.type === 'yearly' ? 400 : 90;
      const nextDs = getNextOccurrence(e, _upYestDs, lookahead);
      if (nextDs) _upItems.push({...e, _displayDate: nextDs});
    } else {
      if (e.date && e.date >= _upYestDs) _upItems.push({...e, _displayDate: e.date});
    }
  });
  // Search + member/type/date-range filters (Phase 4, F3) — applied before
  // the 30-row cap, so filtered results aren't crowded out by rows that would
  // have been excluded anyway.
  const _upSearch=((document.getElementById('upcomingSearch') as HTMLInputElement)?.value||'').trim().toLowerCase();
  const _upMemberFilter=(document.getElementById('upcomingFilterMember') as HTMLSelectElement)?.value||'';
  const _upTypeFilter=(document.getElementById('upcomingFilterType') as HTMLSelectElement)?.value||'';
  const _upFrom=(document.getElementById('upcomingFilterFrom') as HTMLInputElement)?.value||'';
  const _upTo=(document.getElementById('upcomingFilterTo') as HTMLInputElement)?.value||'';
  const _upFiltered=_upItems.filter(e=>{
    if(_upTypeFilter && e.type!==_upTypeFilter) return false;
    if(_upMemberFilter){
      const names=e.members&&e.members.length?e.members:[e.member];
      if(!names.includes(_upMemberFilter)) return false;
    }
    const d=e._displayDate||e.date||'';
    if(_upFrom && d<_upFrom) return false;
    if(_upTo && d>_upTo) return false;
    if(_upSearch){
      const hay=[e.title,e.location,e.notes].filter(Boolean).join(' ').toLowerCase();
      if(!hay.includes(_upSearch)) return false;
    }
    return true;
  });
  const upcoming = _upFiltered.sort((a,b)=>(a._displayDate||'').localeCompare(b._displayDate||'')).slice(0,30);
  document.getElementById('eventBody')!.innerHTML=upcoming.map(e=>`
    <tr>
      <td>
        <div class="td-main">${fmt(e._displayDate||e.date)}</div>
        ${e.endDate&&e.endDate!==e.date&&!e.recurrence?`<div class="td-sub">→ ${fmt(e.endDate)}</div>`:''}
        ${e.recurrence&&e.recurrence.type?`<div class="td-sub" style="color:var(--gray-400);font-size:.72rem">🔁 ${e.recurrence.type}</div>`:''}
        ${e.time?`<div class="td-sub">${fmtTime(e.time)}</div>`:''}
      </td>
      <td><div class="td-main">${esc(e.title)}</div>${e.location?`<div class="td-sub">📍 ${esc(e.location)}</div>`:''}</td>
      <td><span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;font-size:.82rem;flex-wrap:wrap">
        ${(e.members&&e.members.length?e.members:[e.member]).filter(Boolean).map((m: string)=>`<span style="display:inline-flex;align-items:center;gap:3px"><span style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${memberColor(m)}"></span>${esc(memberLabel(m))}</span>`).join('<span style="color:var(--gray-300);font-weight:400"> · </span>')||'—'}
      </span></td>
      <td><span class="type-badge type-${esc(e.type)}">${esc(e.type)}</span></td>
      <td><div style="font-size:.79rem;color:var(--gray-500);max-width:160px">${e.notes?esc(e.notes):'—'}</div></td>
      <td><div class="td-main">${e.recurrence&&e.recurrence.type?`<span style="font-size:.72rem;color:var(--gray-400)">🔁 ${esc(e.recurrence.type)}</span>`:''}</div></td>
      <td>${statusBadge(e._displayDate||e.date,e.completed)}</td>
      <td><div class="btn-actions">
        <button class="btn-icon" title="Sync to Google Calendar" onclick="syncToGCal('${escJs(e.id)}')">📆</button>
        <button class="btn-icon btn-done${e.completed?' is-complete':''}" onclick="toggleEventDone('${escJs(e.id)}')" title="${e.completed?'Mark as not done':'Mark done'}">${e.completed?'✅':'⬜'}</button>
        <button class="btn-icon btn-edit" onclick="editEvent('${escJs(e.id)}','')">✏️</button>
        <button class="btn-icon btn-del"  onclick="confirmDeleteEvent('${escJs(e.id)}','')">🗑</button>
      </div></td>
    </tr>`).join('')||(_upItems.length
    ? `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🔍</div><p>No events match your search/filter</p></div></td></tr>`
    : `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📅</div><p>No upcoming events</p></div></td></tr>`);
}

export function changeMonth(dir: number){
  let y = calYear, m = calMonth + dir;
  if(m>11){m=0;y++;} if(m<0){m=11;y--;}
  setCalYear(y); setCalMonth(m);
  renderCalendar();
}
export function goToday(){ setCalYear(NOW.getFullYear()); setCalMonth(NOW.getMonth()); renderCalendar(); }
export function openCalDay(ds: string){
  (document.getElementById('calEditId') as HTMLInputElement).value='';
  (document.getElementById('calRecurInstanceDate') as HTMLInputElement).value='';
  (document.getElementById('cTitle') as HTMLInputElement).value='';
  (document.getElementById('cDate') as HTMLInputElement).value=ds;
  (document.getElementById('cEndDate') as HTMLInputElement).value='';
  (document.getElementById('cTime') as HTMLInputElement).value='';
  (document.getElementById('cLocation') as HTMLInputElement).value='';
  (document.getElementById('cNotes') as HTMLInputElement).value='';
  const recurSel=document.getElementById('cRecur') as HTMLSelectElement; if(recurSel) recurSel.value='';
  const recurEndEl=document.getElementById('cRecurEnd') as HTMLInputElement; if(recurEndEl) recurEndEl.value='';
  document.querySelectorAll<HTMLInputElement>('input[name="recurDay"]').forEach(cb=>cb.checked=false);
  toggleRecurOptions();
  const notice=document.getElementById('recurInstanceNotice');
  if(notice) (notice as HTMLElement).style.display='none';
  buildEventMemberPicker([],[]);
  openModal('calModal');
}

export async function saveEvent(){
  const id              = (document.getElementById('calEditId') as HTMLInputElement).value;
  const instanceDate    = (document.getElementById('calRecurInstanceDate') as HTMLInputElement).value;
  const editAllFuture   = (document.getElementById('editAllOccurrences') as HTMLInputElement)?.checked;
  const startDate       = (document.getElementById('cDate') as HTMLInputElement).value;
  const endDate         = (document.getElementById('cEndDate') as HTMLInputElement).value;
  const recurType       = (document.getElementById('cRecur') as HTMLSelectElement).value;

  // ── Validation ──
  const _title = ((document.getElementById('cTitle') as HTMLInputElement).value||'').trim();
  if (!_title)     { toast('⚠️ Please enter an event title'); (document.getElementById('cTitle') as HTMLInputElement).focus(); return; }
  if (!startDate)  { toast('⚠️ Please choose a start date');  (document.getElementById('cDate') as HTMLInputElement).focus();  return; }
  if (endDate && endDate < startDate) { toast('⚠️ End date cannot be before the start date'); return; }
  const _recurEndVal = (document.getElementById('cRecurEnd') as HTMLInputElement)?.value;
  if (recurType && _recurEndVal && _recurEndVal < startDate) {
    toast('⚠️ Repeat-until date cannot be before the start date'); return;
  }

  // Build recurrence object
  let recurrence: any = null;
  if (recurType) {
    recurrence = { type: recurType, interval: 1 };
    if (recurType === 'weekly') {
      const checked = [...document.querySelectorAll<HTMLInputElement>('input[name="recurDay"]:checked')].map(cb=>parseInt(cb.value));
      recurrence.daysOfWeek = checked.length ? checked : [new Date(startDate+'T00:00:00').getDay()];
    }
    const recurEnd = (document.getElementById('cRecurEnd') as HTMLInputElement).value;
    if (recurEnd) recurrence.endDate = recurEnd;
  }

  // Collect multi-member selections
  const _selMembers=getEventSelectedMembers();
  const _notifyMembers=getEventNotifyMembers();
  const _primaryMember=_selMembers[0]||'';

  const baseRec: any = {
    title:              _title,
    date:               startDate,
    endDate:            endDate&&endDate>=startDate?endDate:startDate,
    time:               (document.getElementById('cTime') as HTMLInputElement).value,
    type:               (document.getElementById('cType') as HTMLSelectElement).value,
    member:             _primaryMember,   // keep for backward compat
    members:            _selMembers,
    notifyMembers:      _notifyMembers,
    reminderRecipients: _notifyMembers.length?_notifyMembers:'all', // compat
    location:           (document.getElementById('cLocation') as HTMLInputElement).value,
    notes:              (document.getElementById('cNotes') as HTMLInputElement).value,
    updatedBy:          auth.currentUser?.displayName||'',
    updatedAt:          firebase.firestore.FieldValue.serverTimestamp(),
  };

  if (!beginSave('calModal')) return;
  try {
    // ── Case 1: editing a specific occurrence of a recurring series ──
    if (instanceDate && id && !editAllFuture) {
      // Create a standalone exception event for this occurrence
      const exceptionRec = {
        ...baseRec,
        date:              instanceDate,
        endDate:           instanceDate,
        recurringParentId: id,
        exceptionDate:     instanceDate,
        recurrence:        null,
      };
      await withTimeout(db.collection('events').add(exceptionRec));
      // Mark this date as an exception on the parent so the series skips it
      const parentSnap = await db.collection('events').doc(id).get();
      const parentData: any = parentSnap.data() || {};
      const existingExceptions = (parentData.recurrence?.exceptions) || [];
      await withTimeout(db.collection('events').doc(id).update({
        'recurrence.exceptions': [...new Set([...existingExceptions, instanceDate])],
      }));
      closeModal('calModal'); toast('✅ This occurrence updated!');
      return;
    }

    // ── Case 2: new event or editing entire series / non-recurring ──
    const rec: any = { ...baseRec };
    if (recurrence) {
      rec.recurrence = recurrence;
    } else {
      // Explicitly clear recurrence when removing it
      rec.recurrence = null;
    }
    if (id) await withTimeout(db.collection('events').doc(id).set(rec, { merge: true }));
    else    await withTimeout(db.collection('events').add(rec));
    closeModal('calModal'); toast('✅ Event saved!');
  } catch (err) {
    console.error('saveEvent failed:', err);
    toast('❌ Could not save: ' + friendlyError(err));
  } finally {
    endSave('calModal');
  }
}

export function editEvent(id: string, instanceDate=''){
  const e: any=events.find(x=>x.id===id);
  if(!e) return;
  (document.getElementById('calEditId') as HTMLInputElement).value=e.id;
  (document.getElementById('calRecurInstanceDate') as HTMLInputElement).value=instanceDate||'';
  (document.getElementById('cTitle') as HTMLInputElement).value=e.title||'';
  // If editing a specific instance, show that date; otherwise show series start date
  const displayDate = instanceDate || e.date || '';
  (document.getElementById('cDate') as HTMLInputElement).value=displayDate;
  (document.getElementById('cEndDate') as HTMLInputElement).value=e.endDate&&e.endDate!==e.date?e.endDate:'';
  (document.getElementById('cTime') as HTMLInputElement).value=e.time||'';
  (document.getElementById('cType') as HTMLSelectElement).value=e.type||'general';
  (document.getElementById('cMember') as HTMLInputElement).value=e.member||''; // compat hidden field
  (document.getElementById('cLocation') as HTMLInputElement).value=e.location||'';
  (document.getElementById('cNotes') as HTMLInputElement).value=e.notes||'';
  // Populate multi-member picker
  const _selM=e.members&&e.members.length?e.members:(e.member?[e.member]:[]);
  const _notifyM=e.notifyMembers&&e.notifyMembers.length?e.notifyMembers:(Array.isArray(e.reminderRecipients)?e.reminderRecipients:[]);
  buildEventMemberPicker(_selM, _notifyM);

  // Recurrence fields
  const r = e.recurrence;
  const recurSel = document.getElementById('cRecur') as HTMLSelectElement;
  if(recurSel) recurSel.value = (r&&r.type) ? r.type : '';
  // Uncheck all day boxes, then re-check saved ones
  document.querySelectorAll<HTMLInputElement>('input[name="recurDay"]').forEach(cb=>{
    cb.checked = r&&r.type==='weekly'&&r.daysOfWeek ? r.daysOfWeek.includes(parseInt(cb.value)) : false;
  });
  const recurEndEl = document.getElementById('cRecurEnd') as HTMLInputElement;
  if(recurEndEl) recurEndEl.value = (r&&r.endDate) ? r.endDate : '';
  toggleRecurOptions();

  // Show / hide the "editing a single occurrence" notice
  const notice = document.getElementById('recurInstanceNotice') as HTMLElement;
  const editAllCb = document.getElementById('editAllOccurrences') as HTMLInputElement;
  if(instanceDate && r && r.type) {
    notice.style.display='';
    editAllCb.checked=false;
    const d = new Date(instanceDate+'T00:00:00');
    document.getElementById('recurInstanceDateLabel')!.textContent =
      d.toLocaleDateString('en-CA',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  } else {
    notice.style.display='none';
    if(editAllCb) editAllCb.checked=false;
  }

  openModal('calModal');
}

export function toggleRecurOptions(){
  const val = (document.getElementById('cRecur') as HTMLSelectElement)?.value||'';
  const recurEndGroup   = document.getElementById('recurEndGroup') as HTMLElement;
  const weeklyDayPicker = document.getElementById('weeklyDayPicker') as HTMLElement;
  if(recurEndGroup)   recurEndGroup.style.display   = val ? ''     : 'none';
  if(weeklyDayPicker) weeklyDayPicker.style.display  = val==='weekly' ? '' : 'none';
  // If no recurrence chosen, also hide the instance-editing notice
  if(!val){
    const notice=document.getElementById('recurInstanceNotice');
    if(notice) (notice as HTMLElement).style.display='none';
  }
}
