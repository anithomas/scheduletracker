// ─── AUTO ─────────────────────────────────────────────────────
import { auth, db, firebase } from './firebase-init';
import { HST_RATE } from '../config';
import { esc, escJs } from './html-escape';
import { toast, daysUntil, statusBadge, progressBar, fmt, costWithHst } from './utils';
import { autoRecords, beginSave, endSave, withTimeout, friendlyError } from './save-guards';
import { appVehicles } from './settings';
import { getVehicleForRecord, autoRowVehicle } from './vehicles';
import { lightenColor } from './member-prefs';
import { vehicleDisplayName } from './display-names';
import { durLabel, updateHst, updateKm } from './tax';
import { fileIcon, uploadFiles, openAttachmentLink } from './file-upload';
import { isRecurring, markDone } from './mark-done';
import { openModal, closeModal } from './modal';
import { confirmDialog } from './dialogs';

export function renderAuto() {
  const over =autoRecords.filter(r=>{if(r.completed)return false;const d=daysUntil(r.nextDate);return d!==null&&d<0;}).length;
  const due30=autoRecords.filter(r=>{if(r.completed)return false;const d=daysUntil(r.nextDate);return d!==null&&d>=0&&d<=30;}).length;
  const totalSpend=autoRecords.reduce((s,r)=>s+(parseFloat(r.cost)||0)*(1+HST_RATE),0);

  document.getElementById('autoStats')!.innerHTML=`
    <div class="stat-card"><div class="stat-icon-wrap blue">🚗</div><div><div class="stat-value">${appVehicles.length}</div><div class="stat-label">Vehicles Tracked</div></div></div>
    <div class="stat-card"><div class="stat-icon-wrap red">⚠️</div><div><div class="stat-value" style="color:var(--red)">${over}</div><div class="stat-label">Overdue Services</div></div></div>
    <div class="stat-card"><div class="stat-icon-wrap amber">🔔</div><div><div class="stat-value" style="color:var(--amber)">${due30}</div><div class="stat-label">Due in 30 Days</div></div></div>
    <div class="stat-card"><div class="stat-icon-wrap green">💰</div><div><div class="stat-value" style="font-size:1.2rem">${totalSpend>0?'$'+totalSpend.toFixed(0):'—'}</div><div class="stat-label">Total Spend (w/HST)</div></div></div>`;

  document.getElementById('vehiclesGrid')!.innerHTML=appVehicles.map(v=>{
      const vRecords=autoRecords.filter(r=>getVehicleForRecord(r)?.id===v.id);
      const grad=`linear-gradient(135deg,${v.color||'#0b1f3a'},${lightenColor(v.color||'#0b1f3a')})`;
      return `<div class="vehicle-card">
        <div class="vehicle-header" style="background:${grad}">
          <div class="vehicle-emoji">${esc(v.emoji||'🚗')}</div>
          <div class="vehicle-info"><h3>${esc(vehicleDisplayName(v))}</h3><p>${vRecords.length} service items${v.trim?' · '+esc(v.trim):''}</p></div>
        </div>
        <div class="vehicle-body">
          ${vRecords.slice(0,4).map(r=>`
            <div class="mini-item">
              <div><div class="mini-service">${esc(r.service)}</div><div class="mini-date">${fmt(r.nextDate)}${r.nextMileage?' · '+Number(r.nextMileage).toLocaleString()+' km':''}</div></div>
              ${statusBadge(r.nextDate,r.completed)}
            </div>`).join('')||'<div class="empty-state" style="padding:16px"><p>No records yet</p></div>'}
        </div>
      </div>`;
    }).join('');

  document.getElementById('autoBody')!.innerHTML=autoRecords.map(r=>`
    <tr>
      <td><div class="td-main">${esc(autoRowVehicle(r))}</div>${r.durVal?`<div class="td-sub">${esc(durLabel(r.durVal,r.durUnit))}</div>`:''}</td>
      <td><div class="td-main">${esc(r.service)}</div></td>
      <td><div class="td-main">${fmt(r.lastDate)}</div></td>
      <td><div class="td-main">${fmt(r.nextDate)}</div><div class="td-sub">${r.nextMileage?Number(r.nextMileage).toLocaleString('en-CA')+' km':''}</div></td>
      <td class="col-odo"><div class="td-main">${r.mileage?Number(r.mileage).toLocaleString('en-CA')+' km':'—'}</div>${r.kmInterval?`<div class="td-sub">+${Number(r.kmInterval).toLocaleString('en-CA')} km/svc</div>`:''}</td>
      <td>${costWithHst(r.cost, r.taxRate)}</td>
      <td>${statusBadge(r.nextDate,r.completed)}</td>
      <td class="col-progress" style="min-width:80px">${progressBar(r.lastDate,r.nextDate)}</td>
      <td><div class="btn-actions">
        ${[...(r.attachmentUrls||[]),...(r.attachmentUrl&&!(r.attachmentUrls||[]).includes(r.attachmentUrl)?[r.attachmentUrl]:[])].map((u,i)=>`<a class="btn-icon btn-attach" href="javascript:void(0)" onclick="openAttachmentLink('${escJs(u)}')" title="File ${i+1}">${fileIcon(u)}</a>`).join('')}
        <button class="btn-icon btn-done${r.completed?' is-complete':''}" onclick="toggleAutoDone('${escJs(r.id)}')" title="${r.completed?'Mark as not done':isRecurring(r)?'Mark done — schedules the next one':'Mark done'}">${r.completed?'✅':'⬜'}</button>
        <button class="btn-icon btn-edit" onclick="editAuto('${escJs(r.id)}')" title="Edit">✏️</button>
        <button class="btn-icon btn-del"  onclick="delAuto('${escJs(r.id)}')"  title="Delete">🗑</button>
      </div></td>
    </tr>`).join('')||`<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🔧</div><p>No service records yet</p></div></td></tr>`;
}

export async function saveAuto() {
  const id=(document.getElementById('autoEditId') as HTMLInputElement).value;

  // ── Validation ──
  const _aVehicle = (document.getElementById('aVehicle') as HTMLSelectElement).value;
  const _aService = ((document.getElementById('aService') as HTMLInputElement).value||'').trim();
  const _aLast    = (document.getElementById('aLastDate') as HTMLInputElement).value;
  const _aNext    = (document.getElementById('aNextDate') as HTMLInputElement).value;
  if (!_aVehicle) { toast('⚠️ Please choose a vehicle'); return; }
  if (!_aService) { toast('⚠️ Please choose a service'); return; }
  if (!_aLast)    { toast('⚠️ Please enter the last service date'); (document.getElementById('aLastDate') as HTMLInputElement).focus(); return; }
  if (_aNext && _aNext < _aLast) { toast('⚠️ Next due date cannot be before the last service date'); return; }

  if (!beginSave('autoModal')) return;
  try {
    const newFiles=Array.from((document.getElementById('aFile') as HTMLInputElement)?.files||[]);
    const uid=auth.currentUser?.uid||'anon';
    let existingUrls: string[]=[];
    try{ existingUrls=JSON.parse((document.getElementById('autoEditId') as HTMLInputElement).dataset.existingUrls||'[]'); }catch(e){}
    const legacyUrl=(document.getElementById('autoEditId') as HTMLInputElement).dataset.existingUrl||null;
    if(legacyUrl && !existingUrls.includes(legacyUrl)) existingUrls.unshift(legacyUrl);
    let newUrls: string[]=[];
    if(newFiles.length>0){ newUrls=await uploadFiles(newFiles,uid,'auto'); }
    const attachmentUrls=[...existingUrls,...newUrls].filter(Boolean);
    const attachmentUrl=attachmentUrls[0]||null;
    const taxPct = parseFloat((document.getElementById('aTaxRate') as HTMLInputElement)?.value)||13;
    const totalOverride = parseFloat((document.getElementById('aTotalEdit') as HTMLInputElement)?.value)||null;
    const rec={
      vehicleId:_aVehicle,
      vehicle:(appVehicles.find(v=>v.id===_aVehicle)||{} as any).name||_aVehicle,
      service:_aService,
      lastDate:_aLast,
      nextDate:_aNext,
      mileage:(document.getElementById('aMileage') as HTMLInputElement).value,
      kmInterval:(document.getElementById('aKmInterval') as HTMLInputElement).value,
      nextMileage:(document.getElementById('aNextMileage') as HTMLInputElement).value,
      cost:(document.getElementById('aCost') as HTMLInputElement).value,
      taxRate:taxPct,
      totalOverride:totalOverride,
      durVal:(document.getElementById('aDurVal') as HTMLInputElement).value,
      durUnit:(document.getElementById('aDurUnit') as HTMLSelectElement).value,
      notes:(document.getElementById('aNotes') as HTMLInputElement).value,
      attachmentUrl:attachmentUrl||null,
      attachmentUrls:attachmentUrls.length>0?attachmentUrls:null,
      updatedBy:auth.currentUser?.displayName||'',
      updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
    };
    if(id) await withTimeout(db.collection('autoRecords').doc(id).set(rec, { merge: true }));
    else   await withTimeout(db.collection('autoRecords').add(rec));
    closeModal('autoModal'); toast('✅ Service record saved!');
  } catch (err) {
    console.error('saveAuto failed:', err);
    toast('❌ Could not save: ' + friendlyError(err));
  } finally {
    endSave('autoModal');
  }
}

export function editAuto(id: string){
  const r: any=autoRecords.find(x=>x.id===id);
  (document.getElementById('autoEditId') as HTMLInputElement).value=r.id;
  (document.getElementById('autoEditId') as HTMLInputElement).dataset.existingUrl=r.attachmentUrl||'';
  const aAllUrls=[...(r.attachmentUrls||[]),...(r.attachmentUrl&&!(r.attachmentUrls||[]).includes(r.attachmentUrl)?[r.attachmentUrl]:[])];
  (document.getElementById('autoEditId') as HTMLInputElement).dataset.existingUrls=JSON.stringify(aAllUrls);
  (document.getElementById('aVehicle') as HTMLSelectElement).value=r.vehicleId||(getVehicleForRecord(r)&&(getVehicleForRecord(r) as any).id)||r.vehicle;
  (document.getElementById('aService') as HTMLInputElement).value=r.service;
  (document.getElementById('aLastDate') as HTMLInputElement).value=r.lastDate||'';
  (document.getElementById('aNextDate') as HTMLInputElement).value=r.nextDate||'';
  (document.getElementById('aMileage') as HTMLInputElement).value=r.mileage||'';
  (document.getElementById('aKmInterval') as HTMLInputElement).value=r.kmInterval||'';
  (document.getElementById('aNextMileage') as HTMLInputElement).value=r.nextMileage||'';
  (document.getElementById('aCost') as HTMLInputElement).value=r.cost||'';
  const taxEl=document.getElementById('aTaxRate') as HTMLInputElement;
  if(taxEl){taxEl.value=r.taxRate||13;}
  const totalEl=document.getElementById('aTotalEdit') as HTMLInputElement;
  if(totalEl){totalEl.value=r.totalOverride||'';totalEl.dataset.manualOverride=r.totalOverride?'1':'';}
  (document.getElementById('aDurVal') as HTMLInputElement).value=r.durVal||'';
  (document.getElementById('aDurUnit') as HTMLSelectElement).value=r.durUnit||'months';
  (document.getElementById('aNotes') as HTMLInputElement).value=r.notes||'';
  document.getElementById('aFilePreview')!.innerHTML='';
  document.getElementById('aExistingFile')!.innerHTML=aAllUrls.length>0?aAllUrls.map((u,i)=>`<a class="attachment-link" href="javascript:void(0)" onclick="openAttachmentLink('${escJs(u)}')">${fileIcon(u)} File ${aAllUrls.length>1?i+1:''}</a>`).join(' '):'';
  updateHst('a'); updateKm();
  openModal('autoModal');
}

export async function delAuto(id: string) {
  if(!(await confirmDialog('Delete this record?'))) return;
  try {
    await db.collection('autoRecords').doc(id).delete();
    toast('🗑 Record deleted');
  } catch(err){ console.error('delAuto failed:',err); toast('❌ Could not delete: '+friendlyError(err)); }
}

export async function toggleAutoDone(id: string) {
  const r=autoRecords.find(x=>x.id===id);
  if(r) await markDone('autoRecords', r);
}
