// ─── DELETE EVENT (recurring-aware) ────────────────────────────
// Single entry point for every delete trigger (Upcoming-list trash icon,
// and the Delete button inside the edit modal — which is how a stray
// recurring instance clicked on the calendar grid now gets a delete
// option at all; before this it had none). A plain one-off event (or an
// already-materialized single-occurrence exception doc) just confirms
// and deletes. A recurring series instead opens deleteEventModal with
// up to three outcomes:
//   • "Just this date"           — only offered when a specific occurrence
//                                   was clicked (instanceDate is known);
//                                   adds that date to recurrence.exceptions.
//   • "This and all future"      — sets recurrence.endDate to the day
//                                   before the cutoff date; past history
//                                   (and any earlier exception docs) is
//                                   left untouched.
//   • "Entire series"            — deletes the parent doc and every
//                                   exception doc belonging to it.
// Every outcome gets an Undo toast, since the choices aren't equally
// easy to reverse by hand and a stray series is hard enough to find
// without the fix for it becoming its own trap.
import { db, auth, firebase } from './firebase-init';
import { toast, toastAction } from './utils';
import { events, todayDs, friendlyError } from './save-guards';
import { fmtLong, isoLocal, markDone } from './mark-done';
import { openModal, closeModal } from './modal';
import { confirmDialog } from './dialogs';

let _delEventCtx: { id: string; instanceDate: string } | null = null; // captured for the open deleteEventModal

export async function confirmDeleteEvent(id: string, instanceDate=''){
  const e: any = events.find(x=>x.id===id);
  if(!e) return;

  if(!(e.recurrence && e.recurrence.type)){
    // Plain one-off, or an already-materialized single-occurrence exception doc
    if(!(await confirmDialog('Delete this event?'))) return;
    deleteEventDoc(e);
    return;
  }

  _delEventCtx = {id, instanceDate};
  document.getElementById('delEventSummary')!.textContent =
    `"${e.title}" repeats ${e.recurrence.type}${instanceDate?' — you opened '+fmtLong(instanceDate):''}. What would you like to delete?`;
  const btn = (label: string, kind: string, danger?: boolean) =>
    `<button class="btn btn-ghost" style="width:100%;justify-content:flex-start;text-align:left${danger?';color:var(--red)':''}" onclick="runDeleteChoice('${kind}')">${label}</button>`;
  const choices: string[] = [];
  if(instanceDate) choices.push(btn(`📅 Just ${fmtLong(instanceDate)}`, 'occurrence'));
  choices.push(btn('⏩ This and all future occurrences', 'future'));
  choices.push(btn('🗑 Entire series (every occurrence, past and future)', 'series', true));
  document.getElementById('delEventChoices')!.innerHTML = choices.join('');
  // Only close calModal if this was triggered from inside it (deleteFromModal) —
  // deleting straight off the Upcoming-list trash icon never opened it, and
  // closeModal() would otherwise yank the page's scroll position back to 0.
  const calEl = document.getElementById('calModal');
  if(calEl && calEl.classList.contains('open')) closeModal('calModal');
  openModal('deleteEventModal');
}

// Reads the event + instance date straight off the open edit modal's own
// hidden fields, so the grid's "click an occurrence → edit modal" path
// gets a real delete option for the first time.
export function deleteFromModal(){
  const id = (document.getElementById('calEditId') as HTMLInputElement).value;
  const instanceDate = (document.getElementById('calRecurInstanceDate') as HTMLInputElement).value;
  if(!id) return;
  confirmDeleteEvent(id, instanceDate);
}

export async function runDeleteChoice(kind: string){
  const ctx = _delEventCtx; _delEventCtx = null;
  closeModal('deleteEventModal');
  if(!ctx) return;
  const e: any = events.find(x=>x.id===ctx.id);
  if(!e) return;
  const by = auth.currentUser?.displayName||'';
  const ref = db.collection('events').doc(e.id);

  try {
    if(kind==='occurrence'){
      const ds = ctx.instanceDate;
      const before = e.recurrence.exceptions || [];
      await ref.update({
        'recurrence.exceptions': [...new Set([...before, ds])],
        updatedBy:by, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      });
      toastAction(`🗑 Removed ${fmtLong(ds)}`, 'Undo', async()=>{
        try {
          await ref.update({ 'recurrence.exceptions':before, updatedBy:by, updatedAt:firebase.firestore.FieldValue.serverTimestamp() });
          toast('↩️ Restored');
        } catch(err: any){ toast('⚠️ Undo failed: '+err.message); }
      });

    } else if(kind==='future'){
      const fromDs = ctx.instanceDate || getNextOccurrence(e, todayDs(), 365) || e.date;
      const d = new Date(fromDs+'T00:00:00'); d.setDate(d.getDate()-1);
      const newEnd = isoLocal(d);
      const beforeEnd = e.recurrence.endDate ?? null;
      await ref.update({
        'recurrence.endDate':newEnd, updatedBy:by, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
      });
      toastAction(`🗑 Stopped repeating after ${fmtLong(newEnd)}`, 'Undo', async()=>{
        try {
          await ref.update({
            'recurrence.endDate': beforeEnd===null ? firebase.firestore.FieldValue.delete() : beforeEnd,
            updatedBy:by, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          });
          toast('↩️ Restored');
        } catch(err: any){ toast('⚠️ Undo failed: '+err.message); }
      });

    } else if(kind==='series'){
      if(!(await confirmDialog(`Delete the ENTIRE series for "${e.title}"? This removes all occurrences.`))) return;
      const kids = events.filter(x => x.recurringParentId === e.id);
      const kidData = kids.map(k => { const d: any={...k}; delete d.id; return {id:k.id, data:d}; });
      const parentData: any = {...e}; delete parentData.id;
      for(const k of kids){ try { await db.collection('events').doc(k.id).delete(); } catch(e2){} }
      await ref.delete();
      toastAction(`🗑 Series "${e.title}" deleted`, 'Undo', async()=>{
        try {
          await db.collection('events').doc(e.id).set(parentData);
          for(const k of kidData){ await db.collection('events').doc(k.id).set(k.data); }
          toast('↩️ Series restored');
        } catch(err: any){ toast('⚠️ Undo failed: '+err.message); }
      }, 10000);
    }
  } catch(err: any){
    console.error('event delete failed:', err);
    toast(err.code==='permission-denied' ? '🔒 You have view-only access' : '⚠️ Could not update: '+err.message);
  }
}

export async function deleteEventDoc(e: any){
  const data: any = {...e}; const id = e.id; delete data.id;
  try {
    await db.collection('events').doc(id).delete();
    toastAction('🗑 Event deleted', 'Undo', async()=>{
      try { await db.collection('events').doc(id).set(data); toast('↩️ Restored'); }
      catch(err: any){ toast('⚠️ Undo failed: '+err.message); }
    });
  } catch(err){ console.error('deleteEventDoc failed:',err); toast('❌ Could not delete: '+friendlyError(err)); }
}

export async function toggleEventDone(id: string){
  // Events have no durVal/freq, so isRecurring() in markDone() always reads
  // false for them — this is a plain completed/not-completed toggle on the
  // event doc, same as Auto/Home's one-off path. Note: a recurring series
  // shows as a single row (its next occurrence) in Upcoming Events, so
  // toggling marks the whole series done, not just that one occurrence.
  const e=events.find(x=>x.id===id);
  if(e) await markDone('events', e);
}
