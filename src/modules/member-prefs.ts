// ─── MEMBER PREFS (push devices + notification-type choices) ──────────────
import { db, auth, firebase } from './firebase-init';
import { esc } from './html-escape';
import { VAPID_KEY } from '../config';
import {
  appConfig, appVehicles, appMembers, setAppVehicles, setAppMembers,
  VEHICLE_COLORS, homeCategories, serviceTypes, currentUserRole,
} from './settings';
import { vehicleDisplayName, memberDisplayName, getInitials } from './display-names';
import { openModal, closeModal } from './modal';
import { applySettings, saveSettings } from './vehicles';
import { _deviceListHTML, getDeviceInfo, registerDeviceForMember, unregisterDeviceForMember, messaging } from './notifications';
import { toast } from './utils';
import { confirmDialog } from './dialogs';

// Phase 2, S1: this used to live inline on settings/config.members, where any
// signed-in member could write the *whole* members array — not just their
// own entry — because the old rule only checked which top-level
// settings/config keys changed. It now lives in its own memberPrefs/{email}
// doc, one per person, which firestore.rules lets a member read/write only
// for their own (lowercased) sign-in email; an admin may read/write anyone's.
let memberPrefsMap: Record<string, any> = {}; // lowercased email -> {fcmTokens, notifyTypes}

// A member's current device/notification prefs, merged from memberPrefs —
// falling back to the legacy inline settings/config.members fields for
// anyone who hasn't triggered a write (and so a migration) since this
// shipped, so no one's already-registered devices appear to vanish.
export function prefsFor(member: any) {
  const email=(member?.email||'').toLowerCase();
  if(email && memberPrefsMap[email]) return memberPrefsMap[email];
  return { fcmTokens:member?.fcmTokens||[], notifyTypes:member?.notifyTypes||[] };
}

// Writes a patch (fcmTokens and/or notifyTypes) to one person's memberPrefs
// doc — never to settings/config, so this can never touch anyone else's
// data. `email` may be the signed-in user's own, or (admin only) another
// member's.
export async function writeMemberPrefs(email: string, patchFn: (cur: any) => any) {
  const key=(email||'').toLowerCase();
  if(!key) throw new Error('No email on file for this member');
  const cur=memberPrefsMap[key]||{fcmTokens:[],notifyTypes:[]};
  const patch=patchFn(cur);
  // Phase 4, F10: stamp who actually made the change, not just when — the
  // actor may be this member themselves, or (device-removal, notifyTypes)
  // an admin editing someone else's doc from the Admin screen.
  await db.collection('memberPrefs').doc(key).set(
    {...patch, updatedBy:auth.currentUser?.displayName||'', updatedAt:firebase.firestore.FieldValue.serverTimestamp()},
    {merge:true}
  );
  memberPrefsMap[key]={...cur,...patch}; // optimistic; the listener confirms it
}

// Live memberPrefs updates (Phase 2, S2) — an admin gets every member's
// prefs (device counts on the Admin screen); everyone else gets only their
// own doc, which is all firestore.rules lets a non-admin list/read.
export function startPrefsListener() {
  if(currentUserRole==='admin'){
    return db.collection('memberPrefs').onSnapshot(s=>{
      const next: Record<string, any> = {};
      s.forEach(d=>{ next[d.id]=d.data(); });
      memberPrefsMap=next;
      renderAdminMembers();
      if(document.getElementById('myProfileModal')?.classList.contains('open')) _renderMyProfileDevices(_myProfileMember());
    }, err=>console.warn('memberPrefs listener error',err));
  }
  const email=(auth.currentUser?.email||'').toLowerCase();
  if(!email) return ()=>{};
  return db.collection('memberPrefs').doc(email).onSnapshot(snap=>{
    memberPrefsMap[email]=snap.exists?snap.data():{fcmTokens:[],notifyTypes:[]};
    if(document.getElementById('myProfileModal')?.classList.contains('open')) _renderMyProfileDevices(_myProfileMember());
  }, err=>console.warn('memberPrefs listener error',err));
}

export function rebuildVehicleDropdowns(){
  const opts=appVehicles.map(v=>`<option value="${v.id}">${v.emoji} ${vehicleDisplayName(v)}</option>`).join('');
  ['aVehicle'].forEach(id=>{const el=document.getElementById(id) as HTMLSelectElement;if(el){const cur=el.value;el.innerHTML=opts;if(cur)el.value=cur;}});
  const rfv=document.getElementById('rfVehicle') as HTMLSelectElement;
  if(rfv){const cur=rfv.value;rfv.innerHTML='<option value="">All Vehicles</option>'+opts;if(cur)rfv.value=cur;}
}

export function rebuildMemberDropdowns(){
  // Report filter dropdown (unchanged)
  const opts=appMembers.map(m=>`<option value="${m.name}">${memberDisplayName(m)}</option>`).join('');
  const rfm=document.getElementById('rfMember') as HTMLSelectElement;
  if(rfm){const cur=rfm.value;rfm.innerHTML='<option value="">All Members</option>'+opts+'<option value="All">All</option>';if(cur)rfm.value=cur;}
  // Build multi-member checkbox picker for event modal
  buildEventMemberPicker([],[]);
}

// Build the event modal member chip-checkboxes and notify section
// selectedMembers = array of member names already checked for "event members"
// notifyMembers = array of names checked for notifications
export function buildEventMemberPicker(selectedMembers: string[], notifyMembers: string[]) {
  const wrap=document.getElementById('cMembersWrap');
  const nwrap=document.getElementById('cNotifyWrap');
  if(!wrap||!nwrap) return;
  // Auto-derive notify: event members + members whose notifyTypes matches current event type
  const evType=((document.getElementById('cType') as HTMLSelectElement)?.value||'').toLowerCase();
  const autoNotify=new Set(selectedMembers);
  appMembers.forEach(m=>{
    const nt=prefsFor(m).notifyTypes||[];
    if(nt.includes('all')||(evType&&nt.includes(evType))) autoNotify.add(m.name);
  });
  // If notifyMembers passed, union with auto
  if(notifyMembers&&notifyMembers.length) notifyMembers.forEach(n=>autoNotify.add(n));
  wrap.innerHTML=appMembers.map(m=>{
    const checked=selectedMembers.includes(m.name);
    return `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;padding:5px 10px;border:1.5px solid ${checked?m.color:'var(--gray-200)'};border-radius:20px;background:${checked?m.color+'18':'var(--gray-50)'};font-size:.82rem;font-weight:${checked?'700':'500'};color:${checked?m.color:'var(--gray-600)'};transition:all .15s;touch-action:manipulation">
      <input type="checkbox" class="c-member-cb" value="${m.name}" style="width:auto;accent-color:${m.color}" ${checked?'checked':''} onchange="onEventMemberChange()" />
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0"></span>
      ${m.nickname||m.name.split(' ')[0]}
    </label>`;
  }).join('');
  nwrap.innerHTML=appMembers.map(m=>{
    const isAuto=autoNotify.has(m.name);
    return `<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;padding:5px 10px;border:1.5px solid ${isAuto?m.color:'var(--gray-200)'};border-radius:20px;background:${isAuto?m.color+'18':'var(--gray-50)'};font-size:.82rem;font-weight:${isAuto?'700':'500'};color:${isAuto?m.color:'var(--gray-500)'};transition:all .15s;touch-action:manipulation" title="${isAuto?'Will be notified':'Not notified'}">
      <input type="checkbox" class="c-notify-cb" value="${m.name}" style="width:auto;accent-color:${m.color}" ${isAuto?'checked':''} />
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${m.color};flex-shrink:0"></span>
      ${m.nickname||m.name.split(' ')[0]}
      ${isAuto?'<span style="font-size:.7rem;opacity:.7">🔔</span>':''}
    </label>`;
  }).join('');
}

export function onEventMemberChange(){
  // Re-derive notify list when members change
  const sel=getEventSelectedMembers();
  buildEventMemberPicker(sel, getEventNotifyMembers());
}

export function getEventSelectedMembers(){
  return [...document.querySelectorAll<HTMLInputElement>('.c-member-cb:checked')].map(c=>c.value);
}
export function getEventNotifyMembers(){
  return [...document.querySelectorAll<HTMLInputElement>('.c-notify-cb:checked')].map(c=>c.value);
}

export function rebuildCategoryDropdowns(){
  const opts=homeCategories.map(c=>`<option>${c}</option>`).join('');
  ['hCategory'].forEach(id=>{const el=document.getElementById(id) as HTMLSelectElement;if(el){const cur=el.value;el.innerHTML=opts;if(cur)el.value=cur;}});
  const rfhc=document.getElementById('rfHomeCategory') as HTMLSelectElement;
  if(rfhc){const cur=rfhc.value;rfhc.innerHTML='<option value="">All Categories</option>'+opts;if(cur)rfhc.value=cur;}
}

export function rebuildServiceDropdowns(){
  const opts=serviceTypes.map(s=>`<option>${esc(s)}</option>`).join('');
  ['aService'].forEach(id=>{const el=document.getElementById(id) as HTMLSelectElement;if(el){const cur=el.value;el.innerHTML=opts;if(cur)el.value=cur;}});
}

export function renderMemberLegend(){
  const legend=document.getElementById('calMemberLegend');
  if(!legend) return;
  legend.innerHTML='<span style="font-size:.73rem;font-weight:700;color:var(--gray-500);margin-right:4px;">BY MEMBER:</span>'+
    appMembers.map(m=>`<div class="legend-item"><div class="legend-dot" style="background:${esc(m.color)}"></div>${esc(memberDisplayName(m))}</div>`).join('')+
    '<div class="legend-item"><div class="legend-dot" style="background:var(--m-all)"></div>All/Family</div>';
}

export function previewBranding(){
  const name=(document.getElementById('cfgAppName') as HTMLInputElement).value||'Family Household Tracker';
  const em=(document.getElementById('cfgLogoEmoji') as HTMLInputElement).value||'🏠';
  document.getElementById('brandingPreviewEmoji')!.textContent=em;
  document.getElementById('brandingPreviewName')!.textContent=name;
}

export async function saveBranding(){
  appConfig.appName=(document.getElementById('cfgAppName') as HTMLInputElement).value||'Family Household Tracker';
  appConfig.logoEmoji=(document.getElementById('cfgLogoEmoji') as HTMLInputElement).value||'🏠';
  applySettings();
  await saveSettings();
  const si=document.getElementById('brandingSaved')!;si.classList.add('show');setTimeout(()=>si.classList.remove('show'),2000);
  toast('✅ Branding saved!');
}

export async function saveTaxSettings(){
  appConfig.defaultTaxRate=parseFloat((document.getElementById('cfgTaxRate') as HTMLInputElement).value)||13;
  appConfig.currency=(document.getElementById('cfgCurrency') as HTMLInputElement).value||'$';
  await saveSettings();
  const si=document.getElementById('taxSaved')!;si.classList.add('show');setTimeout(()=>si.classList.remove('show'),2000);
  toast('✅ Tax settings saved!');
}

export function renderAdminVehicles(){
  const list=document.getElementById('adminVehicleList');
  if(!list) return;
  if(!appVehicles.length){list.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-icon">🚗</div><p>No vehicles configured</p></div>';return;}
  list.innerHTML=appVehicles.map(v=>`
    <div class="vehicle-config-item">
      <div class="vehicle-config-banner" style="background:linear-gradient(135deg,${v.color||'#0b1f3a'},${lightenColor(v.color||'#0b1f3a')})">
        <span style="font-size:1.7rem">${v.emoji||'🚗'}</span>
        <div class="vehicle-config-info">
          <h4>${vehicleDisplayName(v)}</h4>
          <p>${[v.year,v.make,v.model,v.trim].filter(Boolean).join(' · ')}</p>
        </div>
        <div class="vehicle-config-actions">
          <button class="vca-btn" onclick="openAdminVehicleModal('${v.id}')" title="Edit">✏️</button>
          <button class="vca-btn vca-del" onclick="delAdminVehicle('${v.id}')" title="Remove">🗑</button>
        </div>
      </div>
      <div class="vehicle-config-detail">
        ${v.plate?`<span class="vcd-tag">🪪 <strong>${v.plate}</strong></span>`:''}
        ${v.vin?`<span class="vcd-tag">VIN: <strong>${v.vin}</strong></span>`:''}
        ${!v.plate&&!v.vin?`<span class="vcd-tag" style="color:var(--gray-300)">No plate or VIN added</span>`:''}
      </div>
    </div>`).join('');
}

export function lightenColor(hex: string) {
  const map: Record<string, string> = {
    '#0b1f3a':'#4a5f7a', '#071427':'#0b1f3a',   // teal base/deep
    '#e76f51':'#f1ac9a', '#a03d24':'#e76f51',   // coral base/deep
    '#d9a441':'#e9c98d', '#96690f':'#d9a441',   // gold base/deep
    '#2c8a5d':'#a8dac0', '#1f6f4a':'#2c8a5d',   // sage base/deep
    '#334155':'#64748b',                        // ink
  };
  return map[hex]||'#64748b';
}

export function openAdminVehicleModal(id: string) {
  const v: any=id?appVehicles.find(x=>x.id===id):null;
  (document.getElementById('vehicleCfgId') as HTMLInputElement).value=id||'';
  (document.getElementById('vcName') as HTMLInputElement).value=v?.name||'';
  if(document.getElementById('vcNickname')) (document.getElementById('vcNickname') as HTMLInputElement).value=v?.nickname||'';
  (document.getElementById('vcEmoji') as HTMLInputElement).value=v?.emoji||'🚗';
  (document.getElementById('vcYear') as HTMLInputElement).value=v?.year||'';
  (document.getElementById('vcMake') as HTMLInputElement).value=v?.make||'';
  (document.getElementById('vcModel') as HTMLInputElement).value=v?.model||'';
  (document.getElementById('vcTrim') as HTMLInputElement).value=v?.trim||'';
  (document.getElementById('vcPlate') as HTMLInputElement).value=v?.plate||'';
  (document.getElementById('vcVin') as HTMLInputElement).value=v?.vin||'';
  (document.getElementById('vcColor') as HTMLInputElement).value=v?.color||VEHICLE_COLORS[0];
  document.getElementById('vcColorGrid')!.innerHTML=VEHICLE_COLORS.map(c=>
    `<button class="color-swatch-btn${v?.color===c?' selected':''}" style="background:${c}" onclick="selectVehicleColor('${c}',this)" title="${c}"></button>`
  ).join('');
  openModal('adminVehicleModal');
}

export function selectVehicleColor(c: string, btn: HTMLElement) {
  (document.getElementById('vcColor') as HTMLInputElement).value=c;
  document.querySelectorAll('#vcColorGrid .color-swatch-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
}

export async function saveAdminVehicle(){
  const id=(document.getElementById('vehicleCfgId') as HTMLInputElement).value;
  const _vNick=(document.getElementById('vcNickname') as HTMLInputElement)?.value.trim()||'';
  const v: any={
    id:id||'v'+Date.now(),
    name:(document.getElementById('vcName') as HTMLInputElement).value.trim(),
    nickname:_vNick,
    emoji:(document.getElementById('vcEmoji') as HTMLInputElement).value||'🚗',
    year:(document.getElementById('vcYear') as HTMLInputElement).value,
    make:(document.getElementById('vcMake') as HTMLInputElement).value.trim(),
    model:(document.getElementById('vcModel') as HTMLInputElement).value.trim(),
    trim:(document.getElementById('vcTrim') as HTMLInputElement).value.trim(),
    plate:(document.getElementById('vcPlate') as HTMLInputElement).value.trim().toUpperCase(),
    vin:(document.getElementById('vcVin') as HTMLInputElement).value.trim().toUpperCase(),
    color:(document.getElementById('vcColor') as HTMLInputElement).value||VEHICLE_COLORS[0],
  };
  if(!v.name){toast('⚠️ Vehicle name is required');return;}
  if(id){const i=appVehicles.findIndex(x=>x.id===id);if(i>-1)appVehicles[i]=v;}
  else appVehicles.push(v);
  await saveSettings();
  applySettings();
  closeModal('adminVehicleModal');
  toast('✅ Vehicle saved!');
}

export async function delAdminVehicle(id: string) {
  if(!(await confirmDialog('Remove this vehicle?'))) return;
  setAppVehicles(appVehicles.filter(v=>v.id!==id));
  await saveSettings();
  applySettings();
  toast('🗑 Vehicle removed');
}

export const MEMBER_COLORS=['#0b1f3a','#e76f51','#d9a441','#2c8a5d','#071427','#a03d24','#96690f','#1f6f4a','#4a5f7a','#f1ac9a','#e9c98d','#a8dac0','#334155','#64748b'];

export function renderAdminMembers(){
  const list=document.getElementById('adminMemberList');
  if(!list) return;
  if(!appMembers.length){list.innerHTML='<div class="empty-state" style="padding:20px"><div class="empty-icon">👥</div><p>No members configured</p></div>';return;}
  const _allNames=appMembers.map(m=>m.name);
  const ROLE_BADGE: Record<string, string>={admin:'<span class="role-badge" style="background:#f9efd9;color:#96690f">👑 Admin</span>',contributor:'<span class="role-badge" style="background:#e4e8f0;color:#0b1f3a">✏️ Contributor</span>',viewer:'<span class="role-badge" style="background:#e3f3ea;color:#1f6f4a">👁 Viewer</span>',denied:'<span class="role-badge" style="background:#fbe9e3;color:#a03d24">🚫 Denied</span>'};
  list.innerHTML=appMembers.map(m=>{
    const role=m.role||'contributor';
    const deviceCount=prefsFor(m).fcmTokens.length;
    const meta=[];
    if(m.email) meta.push(`📧 ${m.email}`);
    if(m.phone) meta.push(`📞 ${m.phone}`);
    if(deviceCount>0) meta.push(`📱 ${deviceCount} device${deviceCount>1?'s':''}`);
    return `
    <div class="member-config-item" style="align-items:flex-start;padding:12px 0">
      <div class="member-swatch" style="background:${m.color};flex-shrink:0;margin-top:2px">${getInitials(m.name,_allNames)}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="member-config-name">${m.name}${m.nickname?` <span style="font-size:.72rem;color:var(--gray-400)">(${m.nickname})</span>`:''}</span>
          ${ROLE_BADGE[role]||ROLE_BADGE.contributor}
        </div>
        ${meta.length?`<div style="font-size:.75rem;color:var(--gray-400);margin-top:3px;line-height:1.6">${meta.join(' &nbsp;·&nbsp; ')}</div>`:'<div style="font-size:.74rem;color:var(--amber);margin-top:2px">⚠️ No email set — member cannot sign in</div>'}
      </div>
      <div class="btn-actions" style="flex-shrink:0">
        <button class="btn-icon btn-edit" onclick="openAdminMemberModal('${m.id}')" title="Edit member">✏️</button>
        <button class="btn-icon btn-del" onclick="delAdminMember('${m.id}')" title="Remove member">🗑</button>
      </div>
    </div>`;
  }).join('');
}

export function openAdminMemberModal(id: string) {
  const m: any=id?appMembers.find(x=>x.id===id):null;
  (document.getElementById('memberCfgId') as HTMLInputElement).value=id||'';
  (document.getElementById('mcName') as HTMLInputElement).value=m?.name||'';
  if(document.getElementById('mcNickname')) (document.getElementById('mcNickname') as HTMLInputElement).value=m?.nickname||'';
  (document.getElementById('mcEmail') as HTMLInputElement).value=m?.email||'';
  (document.getElementById('mcPhone') as HTMLInputElement).value=m?.phone||'';
  // Set role — authorizedUsers is source of truth; member.role is a copy for display
  const authEntry=(appConfig.authorizedUsers||[]).find((u: any)=>u.email&&m?.email&&u.email.toLowerCase()===m.email.toLowerCase());
  (document.getElementById('mcRole') as HTMLSelectElement).value=authEntry?.role||m?.role||'contributor';
  (document.getElementById('mcColor') as HTMLInputElement).value=m?.color||MEMBER_COLORS[0];
  (document.getElementById('memberColorPreview') as HTMLElement).style.background=m?.color||MEMBER_COLORS[0];
  document.getElementById('mcColorGrid')!.innerHTML=MEMBER_COLORS.map(c=>
    `<button class="color-swatch-btn${m?.color===c?' selected':''}" style="background:${c}" onclick="selectMemberColor('${c}',this)" title="${c}"></button>`
  ).join('');
  // Show device section only when editing an existing member
  const devSection=document.getElementById('mcDeviceSection');
  if(m && devSection){
    (devSection as HTMLElement).style.display='block';
    // Render per-device rows
    const tokens=prefsFor(m).fcmTokens;
    const dlEl=document.getElementById('mcDeviceList');
    if(dlEl) dlEl.innerHTML=_deviceListHTML(tokens,'_removeAdminDeviceToken');
    // Register btn — show always; async check will hide if current device already registered
    const regBtn=document.getElementById('mcRegisterBtn');
    if(regBtn) (regBtn as HTMLElement).style.display='inline-flex';
    _updateMemberDeviceBtnState(m);
    // Populate notifyTypes checkboxes
    const nt=prefsFor(m).notifyTypes;
    const isAll=nt.includes('all');
    const notifyAllEl=document.getElementById('mcNotifyAll') as HTMLInputElement;
    if(notifyAllEl) notifyAllEl.checked=isAll;
    document.querySelectorAll<HTMLInputElement>('.mc-notify-type').forEach(cb=>{
      cb.checked=!isAll&&nt.includes(cb.value);
      cb.disabled=isAll;
    });
  } else if(devSection){
    (devSection as HTMLElement).style.display='none';
  }
  openModal('adminMemberModal');
}

export async function _updateMemberDeviceBtnState(m: any) {
  try{
    if(!messaging) return;
    const swReg=await navigator.serviceWorker.ready;
    const token=await messaging.getToken({vapidKey:VAPID_KEY,serviceWorkerRegistration:swReg});
    const isReg=token&&prefsFor(m).fcmTokens.some((d: any)=>(d.token||d)===token);
    const regBtn=document.getElementById('mcRegisterBtn');
    // Hide "Register" button if this device is already registered
    if(regBtn) (regBtn as HTMLElement).style.display=isReg?'none':'inline-flex';
  }catch(e){}
}

// Thin wrapper used by admin modal device list (reads memberId from hidden input)
export function _removeAdminDeviceToken(token: string, btn: HTMLElement) {
  const memberId=(document.getElementById('memberCfgId') as HTMLInputElement).value;
  removeSpecificDeviceToken(memberId, token, btn);
}

// Remove one specific FCM token from a member's device list (admin — writes
// that member's own memberPrefs doc, Phase 2 S1, not settings/config).
export async function removeSpecificDeviceToken(memberId: string, token: string, btn: HTMLElement) {
  const m: any=appMembers.find(x=>x.id===memberId);
  if(!m){toast('Member not found');return;}
  if(!m.email){toast('⚠️ This member has no email on file');return;}
  try{
    if(btn) (btn as HTMLButtonElement).disabled=true;
    await writeMemberPrefs(m.email, cur=>({fcmTokens:(cur.fcmTokens||[]).filter((t: any)=>(t.token||t)!==token)}));
    const dlEl=document.getElementById('mcDeviceList');
    if(dlEl) dlEl.innerHTML=_deviceListHTML(prefsFor(m).fcmTokens,'_removeAdminDeviceToken');
    _updateMemberDeviceBtnState(m);
    renderAdminMembers();
    toast('🗑 Device removed');
  }catch(e: any){toast('⚠️ Failed: '+e.message);if(btn) (btn as HTMLButtonElement).disabled=false;}
}

export function toggleNotifyAll(cb: HTMLInputElement) {
  document.querySelectorAll<HTMLInputElement>('.mc-notify-type').forEach(el=>{
    el.disabled=cb.checked;
    if(cb.checked) el.checked=false;
  });
}

// ── My Profile modal (accessible to all roles) ──────────────────────────────
export function _myProfileMember(){
  const email=(auth.currentUser?.email||'').toLowerCase();
  return appMembers.find(m=>m.email&&m.email.toLowerCase()===email);
}

export function openMyProfile(){
  const user=auth.currentUser;
  const m=_myProfileMember();
  document.getElementById('mpName')!.textContent=user?.displayName||user?.email||'Unknown';
  document.getElementById('mpEmail')!.textContent=user?.email||'';
  _renderMyProfileDevices(m);
  // Populate notify checkboxes
  const nt=prefsFor(m).notifyTypes;
  const isAll=nt.includes('all');
  const allEl=document.getElementById('mpNotifyAll') as HTMLInputElement;
  if(allEl) allEl.checked=isAll;
  document.querySelectorAll<HTMLInputElement>('.mp-notify-type').forEach(cb=>{
    cb.checked=!isAll&&nt.includes(cb.value);
    cb.disabled=isAll;
  });
  openModal('myProfileModal');
}

export function _renderMyProfileDevices(m: any) {
  const tokens=prefsFor(m).fcmTokens;
  const dlEl=document.getElementById('mpDeviceList');
  if(!dlEl) return;
  dlEl.innerHTML=_deviceListHTML(tokens,'removeMyDeviceToken');
  // Show/hide register button based on whether this device is already registered
  if(messaging){
    navigator.serviceWorker.ready.then(sw=>messaging!.getToken({vapidKey:VAPID_KEY,serviceWorkerRegistration:sw}))
      .then(token=>{
        const regBtn=document.getElementById('mpRegisterBtn');
        if(regBtn) (regBtn as HTMLElement).style.display=token&&tokens.some((d: any)=>(d.token||d)===token)?'none':'inline-flex';
      }).catch(()=>{});
  }
}

export function toggleMpNotifyAll(cb: HTMLInputElement) {
  document.querySelectorAll<HTMLInputElement>('.mp-notify-type').forEach(el=>{
    el.disabled=cb.checked;
    if(cb.checked) el.checked=false;
  });
}

export async function registerMyDevice(){
  const m=_myProfileMember();
  if(!m){toast('⚠️ Your profile is not set up in Admin yet — ask your admin to add your account.');return;}
  if(!messaging){toast('⚠️ Push notifications not available');return;}
  try{
    const perm=await Notification.requestPermission();
    if(perm!=='granted'){toast('⚠️ Notifications blocked — please allow in browser settings');return;}
    const sw=await navigator.serviceWorker.ready;
    const token=await messaging.getToken({vapidKey:VAPID_KEY,serviceWorkerRegistration:sw});
    const existing=prefsFor(m).fcmTokens;
    if(existing.some((d: any)=>(d.token||d)===token)){toast('✅ This device is already registered');return;}
    const info=getDeviceInfo();
    await writeMemberPrefs(m.email, cur=>({fcmTokens:[...(cur.fcmTokens||[]),{token,browser:info.browser,os:info.os,icon:info.icon,registeredAt:new Date().toISOString()}]}));
    _renderMyProfileDevices(m);
    toast('✅ Device registered for push notifications!');
  }catch(e: any){toast('⚠️ Registration failed: '+e.message);}
}

export async function removeMyDeviceToken(token: string, btn: HTMLElement) {
  const m=_myProfileMember();
  if(!m) return;
  try{
    if(btn) (btn as HTMLButtonElement).disabled=true;
    await writeMemberPrefs(m.email, cur=>({fcmTokens:(cur.fcmTokens||[]).filter((t: any)=>(t.token||t)!==token)}));
    _renderMyProfileDevices(m);
    toast('🗑 Device removed');
  }catch(e: any){toast('⚠️ Failed: '+e.message);if(btn) (btn as HTMLButtonElement).disabled=false;}
}

export async function saveMyProfile(){
  const m=_myProfileMember();
  if(!m){toast('⚠️ Profile not found');return;}
  const isAll=(document.getElementById('mpNotifyAll') as HTMLInputElement)?.checked;
  const notifyTypes=isAll?['all']:[...document.querySelectorAll<HTMLInputElement>('.mp-notify-type:checked')].map(c=>c.value);
  try { await writeMemberPrefs(m.email, ()=>({notifyTypes})); }
  catch(e: any) { toast('⚠️ Could not save: '+e.message); return; }
  toast('✅ Notification preferences saved');
  closeModal('myProfileModal');
}

export function selectMemberColor(c: string, btn: HTMLElement) {
  (document.getElementById('mcColor') as HTMLInputElement).value=c;
  (document.getElementById('memberColorPreview') as HTMLElement).style.background=c;
  document.querySelectorAll('#mcColorGrid .color-swatch-btn').forEach(b=>b.classList.remove('selected'));
  btn.classList.add('selected');
}

export async function saveAdminMember(){
  const id=(document.getElementById('memberCfgId') as HTMLInputElement).value;
  const _nick=(document.getElementById('mcNickname') as HTMLInputElement)?.value.trim()||'';
  const _email=((document.getElementById('mcEmail') as HTMLInputElement)?.value.trim()||'').toLowerCase();
  const _phone=(document.getElementById('mcPhone') as HTMLInputElement)?.value.trim()||'';
  const _role=(document.getElementById('mcRole') as HTMLSelectElement)?.value||'contributor';
  // Collect notifyTypes — written to memberPrefs below, not to this profile
  // object (Phase 2, S1: devices/notifyTypes no longer live on settings/config).
  const _notifyAll=(document.getElementById('mcNotifyAll') as HTMLInputElement)?.checked;
  const _notifyTypes=_notifyAll?['all']:[...document.querySelectorAll<HTMLInputElement>('.mc-notify-type:checked')].map(c=>c.value);
  const m: any={
    id:id||'m'+Date.now(),
    name:(document.getElementById('mcName') as HTMLInputElement).value.trim(),
    nickname:_nick,
    color:(document.getElementById('mcColor') as HTMLInputElement).value||MEMBER_COLORS[0],
    email:_email,
    phone:_phone,
    role:_role,
  };
  if(!m.name){toast('⚠️ Name is required');return;}
  if(_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_email)){toast('⚠️ Enter a valid email address');return;}
  if(id){const i=appMembers.findIndex(x=>x.id===id);if(i>-1)appMembers[i]=m;}
  else appMembers.push(m);
  // Sync email + role into authorizedUsers so sign-in access is updated automatically
  if(_email){
    const users=appConfig.authorizedUsers||[];
    const ui=users.findIndex((u: any)=>u.email.toLowerCase()===_email);
    if(ui>-1){
      // Warn before downgrading the last admin
      if(users[ui].role==='admin' && _role!=='admin'){
        const admins=users.filter((u: any)=>u.role==='admin');
        if(admins.length===1){toast('⚠️ Cannot remove the last admin role');return;}
      }
      users[ui].role=_role;users[ui].name=m.name;users[ui].updatedAt=new Date().toISOString();
    }
    else users.push({email:_email,name:m.name,role:_role,addedAt:new Date().toISOString()});
    appConfig.authorizedUsers=users;
  }
  await saveSettings();
  if(_email){
    try { await writeMemberPrefs(_email, ()=>({notifyTypes:_notifyTypes})); }
    catch(e: any) { toast('⚠️ Member saved, but notification types failed: '+e.message); }
  }
  applySettings();
  closeModal('adminMemberModal');
  toast('✅ Member saved!');
}

export async function delAdminMember(id: string) {
  if(!(await confirmDialog('Remove this member?'))) return;
  const m: any=appMembers.find(x=>x.id===id);
  setAppMembers(appMembers.filter(x=>x.id!==id));
  // Also remove from authorizedUsers if they had an email
  if(m?.email){
    appConfig.authorizedUsers=(appConfig.authorizedUsers||[]).filter((u: any)=>u.email.toLowerCase()!==m.email.toLowerCase());
  }
  await saveSettings();
  applySettings();
  toast('🗑 Member removed');
}

// Register this browser/device for the member currently open in the modal
export async function registerCurrentMemberDevice(){
  const id=(document.getElementById('memberCfgId') as HTMLInputElement).value;
  if(!id){toast('⚠️ Save the member first');return;}
  await registerDeviceForMember(id);
  // Refresh button state
  const m: any=appMembers.find(x=>x.id===id);
  if(m) _updateMemberDeviceBtnState(m);
  const count=m?prefsFor(m).fcmTokens.length:0;
  document.getElementById('mcDeviceStatusText')!.textContent=count>0?`${count} device${count>1?'s':''} registered for push notifications on this member.`:'No devices registered yet.';
}

export async function unregisterCurrentMemberDevice(){
  const id=(document.getElementById('memberCfgId') as HTMLInputElement).value;
  if(!id) return;
  await unregisterDeviceForMember(id);
  const m: any=appMembers.find(x=>x.id===id);
  if(m) _updateMemberDeviceBtnState(m);
  const count=m?prefsFor(m).fcmTokens.length:0;
  document.getElementById('mcDeviceStatusText')!.textContent=count>0?`${count} device${count>1?'s':''} registered for push notifications on this member.`:'No devices registered yet.';
}
