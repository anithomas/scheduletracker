// ─── MARK DONE / ROLL FORWARD ─────────────────────────────────
// Recurring items (an interval in durVal/durUnit, or legacy freq in days)
// don't get stuck as "Completed": marking done records the service in
// `history`, sets lastDate to today and moves nextDate (and the km target for
// vehicles) forward one interval. One-off items keep the Completed toggle.
import { db, auth, firebase } from './firebase-init';
import { toast, toastAction } from './utils';
import { TODAY, homeItems, beginSave, endSave, withTimeout, friendlyError } from './save-guards';
import { autoRowVehicle } from './vehicles';
import { promptDialog, confirmDialog } from './dialogs';
import { uploadFiles } from './file-upload';
import { fileIcon, openAttachmentLink } from './file-upload';
import { updateHomeDuration, updateHst } from './tax';
import { openModal, closeModal } from './modal';
import { escJs } from './html-escape';

export function isoLocal(d: Date){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function nextOccurrence(item: any, fromIso: string): string | null {
  const [y,m,d]=fromIso.split('-').map(Number);
  const v=parseInt(item.durVal,10);
  if(v>0){
    const unit=item.durUnit||'months';
    if(unit==='days') return isoLocal(new Date(y,m-1,d+v));
    const months=unit==='years'?v*12:v;
    // Clamp to month end: Jan 31 + 1 month -> Feb 28/29, not Mar 3.
    const last=new Date(y,m-1+months+1,0).getDate();
    return isoLocal(new Date(y,m-1+months,Math.min(d,last)));
  }
  const f=parseInt(item.freq,10);
  if(f>0) return isoLocal(new Date(y,m-1,d+f));
  return null;
}
export function isRecurring(item: any){ return nextOccurrence(item, isoLocal(TODAY))!==null; }
export function fmtLong(iso: string){
  const [y,m,d]=iso.split('-').map(Number);
  return new Date(y,m-1,d).toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'});
}

export async function markDone(col: string, item: any){
  const ref=db.collection(col).doc(item.id);
  const by=auth.currentUser?.displayName||'';
  const stamp=firebase.firestore.FieldValue.serverTimestamp();
  try{
    // Un-completing, or a one-off item: plain toggle as before.
    if(item.completed || !isRecurring(item)){
      const completed=!item.completed;
      await ref.update({completed, completedAt:completed?stamp:null, updatedBy:by, updatedAt:stamp});
      toast(completed?'✅ Marked as completed!':'↩️ Marked as not completed');
      return;
    }

    const today=isoLocal(TODAY);
    const next=nextOccurrence(item, today);
    const changes: any={lastDate:today, nextDate:next, completed:false, completedAt:null, updatedBy:by, updatedAt:stamp};
    const entry: any={doneOn:today, wasDue:item.nextDate||'', cost:item.cost||'', by, at:new Date().toISOString()};

    const kmInt=Number(item.kmInterval)||0;
    if(col==='autoRecords' && kmInt>0){
      const label=(typeof autoRowVehicle==='function'?autoRowVehicle(item):'')+' — '+(item.service||'service');
      const guess=item.nextMileage||item.mileage||'';
      const ans=await promptDialog(`Odometer now (km) for ${label}?\nLeave blank if you don't know.`, guess);
      if(ans===null) return;                       // cancelled: change nothing
      const km=parseInt(String(ans).replace(/[^0-9]/g,''),10);
      if(km>0){
        changes.mileage=km; changes.nextMileage=km+kmInt; entry.mileage=km;
      } else if(Number(item.nextMileage)>0){
        changes.nextMileage=Number(item.nextMileage)+kmInt;
      }
    }

    const before={lastDate:item.lastDate||'', nextDate:item.nextDate||'', completed:!!item.completed,
                  mileage:item.mileage??null, nextMileage:item.nextMileage??null};
    await ref.update({...changes, history:firebase.firestore.FieldValue.arrayUnion(entry)});

    toastAction(`✅ Done — next due ${fmtLong(next!)}`, 'Undo', async()=>{
      const restore: any={lastDate:before.lastDate, nextDate:before.nextDate, completed:before.completed,
                     updatedBy:by, updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
                     history:firebase.firestore.FieldValue.arrayRemove(entry)};
      if('mileage' in changes) restore.mileage=before.mileage;
      if('nextMileage' in changes) restore.nextMileage=before.nextMileage;
      try{ await ref.update(restore); toast('↩️ Undone'); }
      catch(e: any){ toast('⚠️ Undo failed: '+e.message); }
    });
  }catch(e: any){
    toast(e.code==='permission-denied' ? '🔒 You have view-only access' : '⚠️ Could not update: '+e.message);
  }
}

export async function saveHome(){
  const id=(document.getElementById('homeEditId') as HTMLInputElement).value;

  // ── Validation ──
  const _hItem = ((document.getElementById('hItem') as HTMLInputElement).value||'').trim();
  const _hLast = (document.getElementById('hLastDate') as HTMLInputElement).value;
  const _hNext = (document.getElementById('hNextDate') as HTMLInputElement).value;
  if (!_hItem) { toast('⚠️ Please enter an item name'); (document.getElementById('hItem') as HTMLInputElement).focus(); return; }
  if (!_hLast) { toast('⚠️ Please enter the last service date'); (document.getElementById('hLastDate') as HTMLInputElement).focus(); return; }
  if (_hNext && _hNext < _hLast) { toast('⚠️ Next due date cannot be before the last service date'); return; }

  if (!beginSave('homeModal')) return;
  try {
    const newFiles=Array.from((document.getElementById('hFile') as HTMLInputElement)?.files||[]);
    const uid=auth.currentUser?.uid||'anon';
    let existingUrls: string[]=[];
    try{ existingUrls=JSON.parse((document.getElementById('homeEditId') as HTMLInputElement).dataset.existingUrls||'[]'); }catch(e){}
    const legacyUrl=(document.getElementById('homeEditId') as HTMLInputElement).dataset.existingUrl||null;
    if(legacyUrl && !existingUrls.includes(legacyUrl)) existingUrls.unshift(legacyUrl);
    let newUrls: string[]=[];
    if(newFiles.length>0){ newUrls=await uploadFiles(newFiles,uid,'home'); }
    const attachmentUrls=[...existingUrls,...newUrls].filter(Boolean);
    const attachmentUrl=attachmentUrls[0]||null;
    const taxPct = parseFloat((document.getElementById('hTaxRate') as HTMLInputElement)?.value)||13;
    const totalOverride = parseFloat((document.getElementById('hTotalEdit') as HTMLInputElement)?.value)||null;
    updateHomeDuration();
    const rec={
      item:_hItem,
      category:(document.getElementById('hCategory') as HTMLSelectElement).value,
      freq:(document.getElementById('hFreq') as HTMLInputElement).value,
      durVal:(document.getElementById('hDurVal') as HTMLInputElement).value,
      durUnit:(document.getElementById('hDurUnit') as HTMLSelectElement).value,
      lastDate:_hLast,
      nextDate:_hNext,
      cost:(document.getElementById('hCost') as HTMLInputElement).value,
      taxRate:taxPct,
      totalOverride:totalOverride,
      notes:(document.getElementById('hNotes') as HTMLInputElement).value,
      attachmentUrl:attachmentUrl||null,
      attachmentUrls:attachmentUrls.length>0?attachmentUrls:null,
      updatedBy:auth.currentUser?.displayName||'',
      updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
    };
    if(id) await withTimeout(db.collection('homeItems').doc(id).set(rec, { merge: true }));
    else   await withTimeout(db.collection('homeItems').add(rec));
    closeModal('homeModal'); toast('✅ Home item saved!');
  } catch (err) {
    console.error('saveHome failed:', err);
    toast('❌ Could not save: ' + friendlyError(err));
  } finally {
    endSave('homeModal');
  }
}

export function editHome(id: string){
  const h: any=homeItems.find(x=>x.id===id);
  (document.getElementById('homeEditId') as HTMLInputElement).value=h.id;
  (document.getElementById('homeEditId') as HTMLInputElement).dataset.existingUrl=h.attachmentUrl||'';
  const hAllUrls=[...(h.attachmentUrls||[]),...(h.attachmentUrl&&!(h.attachmentUrls||[]).includes(h.attachmentUrl)?[h.attachmentUrl]:[])];
  (document.getElementById('homeEditId') as HTMLInputElement).dataset.existingUrls=JSON.stringify(hAllUrls);
  (document.getElementById('hItem') as HTMLInputElement).value=h.item||'';
  (document.getElementById('hCategory') as HTMLSelectElement).value=h.category||'HVAC';
  (document.getElementById('hFreq') as HTMLInputElement).value=h.freq||'90';
  if(h.durVal&&h.durUnit){
    (document.getElementById('hDurVal') as HTMLInputElement).value=h.durVal;
    (document.getElementById('hDurUnit') as HTMLSelectElement).value=h.durUnit;
  } else {
    const f=parseInt(h.freq||'90');
    if(f%365===0){(document.getElementById('hDurVal') as HTMLInputElement).value=String(f/365);(document.getElementById('hDurUnit') as HTMLSelectElement).value='years';}
    else if(f>=28&&f%Math.round(30.44)<=3){(document.getElementById('hDurVal') as HTMLInputElement).value=String(Math.round(f/30.44));(document.getElementById('hDurUnit') as HTMLSelectElement).value='months';}
    else{(document.getElementById('hDurVal') as HTMLInputElement).value=String(f);(document.getElementById('hDurUnit') as HTMLSelectElement).value='days';}
  }
  (document.getElementById('hLastDate') as HTMLInputElement).value=h.lastDate||'';
  (document.getElementById('hNextDate') as HTMLInputElement).value=h.nextDate||'';
  (document.getElementById('hCost') as HTMLInputElement).value=h.cost||'';
  const taxEl=document.getElementById('hTaxRate') as HTMLInputElement;
  if(taxEl){taxEl.value=h.taxRate||13;}
  const totalEl=document.getElementById('hTotalEdit') as HTMLInputElement;
  if(totalEl){totalEl.value=h.totalOverride||'';totalEl.dataset.manualOverride=h.totalOverride?'1':'';}
  (document.getElementById('hNotes') as HTMLInputElement).value=h.notes||'';
  document.getElementById('hFilePreview')!.innerHTML='';
  document.getElementById('hExistingFile')!.innerHTML=hAllUrls.length>0?hAllUrls.map((u,i)=>`<a class="attachment-link" href="javascript:void(0)" onclick="openAttachmentLink('${escJs(u)}')">${fileIcon(u)} File ${hAllUrls.length>1?i+1:''}</a>`).join(' '):'';
  updateHst('h');
  openModal('homeModal');
}

export async function delHome(id: string) {
  if(!(await confirmDialog('Delete?'))) return;
  try {
    await db.collection('homeItems').doc(id).delete();
    toast('🗑 Item deleted');
  } catch(err){ console.error('delHome failed:',err); toast('❌ Could not delete: '+friendlyError(err)); }
}
