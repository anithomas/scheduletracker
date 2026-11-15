// ─── VEHICLE LOOKUP HELPERS ───────────────────────────────────
import { db, firebase } from './firebase-init';
import { vehicleDisplayName } from './display-names';
import {
  appConfig, appVehicles, appMembers, homeCategories, serviceTypes, eventTypes, currentUserRole,
  setAppVehicles, setAppMembers, setHomeCategories, setServiceTypes, setEventTypes,
} from './settings';
import {
  rebuildVehicleDropdowns, rebuildMemberDropdowns, rebuildCategoryDropdowns, rebuildServiceDropdowns,
  renderAdminVehicles, renderAdminMembers, renderMemberLegend,
} from './member-prefs';
import { renderAdminCategories, renderAdminServiceTypes, renderAdminEventTypes, rebuildEventTypeDropdown } from './admin-catalog';
import { renderUserAccess } from './rbac';
import { renderAdminNotifications, rebuildReminderRecipientsDropdown } from './notifications';
import { rebuildRenewalDropdowns } from './renewals';

export function getVehicleForRecord(r: any) {
  if (r.vehicleId) {
    const v = appVehicles.find(v => v.id === r.vehicleId);
    if (v) return v;
  }
  const exact = appVehicles.find(v => v.name === r.vehicle);
  if (exact) return exact;
  if (r.vehicle) {
    const rn = r.vehicle.toLowerCase().trim();
    const fuzzy = appVehicles.find(v => {
      const vn = v.name.toLowerCase().trim();
      return vn.includes(rn) || rn.includes(vn);
    });
    if (fuzzy) return fuzzy;
  }
  return null;
}
export function autoRowVehicle(r: any) {
  const v = getVehicleForRecord(r);
  return (v && v.emoji ? v.emoji : '🚗') + ' ' + (v ? vehicleDisplayName(v) : (r.vehicle || '—'));
}

// Applies a settings/config document (from either the one-time load or the
// live listener below) to the in-memory model and re-renders. Pulled out of
// loadSettings() so both share one code path (Phase 2, S2).
export function applyIncomingSettings(d: any) {
  if(!d) { applySettings(); return; }
  if(d.appName) appConfig.appName=d.appName;
  if(d.logoEmoji) appConfig.logoEmoji=d.logoEmoji;
  if(d.defaultTaxRate!=null) appConfig.defaultTaxRate=d.defaultTaxRate;
  if(d.currency) appConfig.currency=d.currency;
  if(d.vehicles&&d.vehicles.length) setAppVehicles(d.vehicles);
  if(d.members&&d.members.length) setAppMembers(d.members);
  if(d.homeCategories&&d.homeCategories.length) setHomeCategories(d.homeCategories);
  if(d.serviceTypes&&d.serviceTypes.length) setServiceTypes(d.serviceTypes);
  if(d.eventTypes&&d.eventTypes.length) setEventTypes(d.eventTypes);
  if(d.authorizedUsers) appConfig.authorizedUsers=d.authorizedUsers;
  if(d.reminderSettings) appConfig.reminderSettings={...appConfig.reminderSettings,...d.reminderSettings};
  applySettings();
}

export async function loadSettings(){
  try{
    const doc=await db.collection('settings').doc('config').get();
    applyIncomingSettings(doc.exists?doc.data():null);
  } catch(e){ console.warn('Settings load error',e); applySettings(); }
}

// Set while the branding/tax/currency fields below have unsaved local edits,
// so a snapshot from the live settings listener (S2) — e.g. another admin
// saving a change on a different device — can never silently overwrite
// keystrokes this tab hasn't saved yet. Cleared once saveSettings() succeeds.
let _adminFormDirty=false;
export function markAdminFormDirty(){ _adminFormDirty=true; }

export function applySettings(){
  const appNameEls=document.querySelectorAll('.app-name-dynamic');
  appNameEls.forEach(el=>el.textContent=appConfig.appName);
  const logoEls=document.querySelectorAll('.app-logo-dynamic');
  logoEls.forEach(el=>el.textContent=appConfig.logoEmoji);
  document.getElementById('brandingPreviewEmoji')!.textContent=appConfig.logoEmoji;
  document.getElementById('brandingPreviewName')!.textContent=appConfig.appName;
  if(!_adminFormDirty){
    (document.getElementById('cfgAppName') as HTMLInputElement).value=appConfig.appName;
    (document.getElementById('cfgLogoEmoji') as HTMLInputElement).value=appConfig.logoEmoji;
    (document.getElementById('cfgTaxRate') as HTMLInputElement).value=String(appConfig.defaultTaxRate);
    (document.getElementById('cfgCurrency') as HTMLInputElement).value=appConfig.currency||'$';
  }
  document.title=appConfig.appName;
  rebuildVehicleDropdowns();
  rebuildMemberDropdowns();
  rebuildCategoryDropdowns();
  rebuildServiceDropdowns();
  rebuildRenewalDropdowns();
  renderAdminVehicles();
  renderAdminMembers();
  renderAdminCategories();
  renderAdminServiceTypes();
  renderAdminEventTypes();
  rebuildEventTypeDropdown();
  renderMemberLegend();
  document.getElementById('adminVehicleCount')!.textContent=appVehicles.length+' Vehicle'+(appVehicles.length!==1?'s':'');
  document.getElementById('adminMemberCount')!.textContent=appMembers.length+' Member'+(appMembers.length!==1?'s':'');
  if(currentUserRole==='admin') renderUserAccess();
  if(currentUserRole==='admin') renderAdminNotifications();
  rebuildReminderRecipientsDropdown();
  const aTax=document.getElementById('aTaxRate') as HTMLInputElement; if(aTax&&!aTax.dataset.userSet) aTax.value=String(appConfig.defaultTaxRate);
  const hTax=document.getElementById('hTaxRate') as HTMLInputElement; if(hTax&&!hTax.dataset.userSet) hTax.value=String(appConfig.defaultTaxRate);
}

// Lowercased email -> role map. firestore.rules / storage.rules look up the
// signed-in user's role here, so it must stay in sync with authorizedUsers.
export function buildAccessRoles(users: any[]) {
  const map: Record<string, string> = {};
  (users||[]).forEach(u=>{ const e=String(u.email||'').trim().toLowerCase(); if(e) map[e]=u.role||'viewer'; });
  return map;
}
export function sameAccessRoles(a: any, b: any) {
  const ka=Object.keys(a||{}), kb=Object.keys(b||{});
  return ka.length===kb.length && ka.every(k=>a[k]===(b||{})[k]);
}

export async function saveSettings(){
  await db.collection('settings').doc('config').set({
    appName:appConfig.appName,
    logoEmoji:appConfig.logoEmoji,
    defaultTaxRate:appConfig.defaultTaxRate,
    currency:appConfig.currency,
    vehicles:appVehicles,
    members:appMembers,
    homeCategories:homeCategories,
    serviceTypes:serviceTypes,
    eventTypes:eventTypes,
    authorizedUsers:appConfig.authorizedUsers||[],
    authorizedEmails:(appConfig.authorizedUsers||[]).map((u: any)=>u.email).filter(Boolean),
    accessRoles:buildAccessRoles(appConfig.authorizedUsers),
    reminderSettings:appConfig.reminderSettings||{enabled:true,leadTimes:[1,7]},
    updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
  },{merge:true});
  _adminFormDirty=false;
}
