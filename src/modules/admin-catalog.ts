// ─── ADMIN CATALOG (home categories, service types, event types) ──────────
// (Originally the tail half of the "NOTIFICATIONS / REMINDERS" section —
// split out under its own name since it's really the admin CRUD screens for
// these three small catalogs, unrelated to reminders.)
import { esc } from './html-escape';
import { toast } from './utils';
import { homeCategories, serviceTypes, eventTypes, setHomeCategories, setServiceTypes } from './settings';
import { saveSettings } from './vehicles';
import { rebuildCategoryDropdowns, rebuildServiceDropdowns } from './member-prefs';
import { confirmDialog } from './dialogs';

export const CAT_ICONS: Record<string, string> = {'HVAC':'💨','Appliances':'🏠','Plumbing':'🚿','Electrical':'⚡','Lawn & Garden':'🌿','Cleaning':'🧹','Pest Control':'🐛','Pool':'🏊','Roof':'🏗️','Other':'📦'};

export function renderAdminCategories(){
  const list=document.getElementById('adminCatList');
  if(!list) return;
  list.innerHTML=homeCategories.map(c=>`
    <div class="tag-chip">${CAT_ICONS[c]||'📦'} ${c}<button onclick="removeCat('${c.replace(/'/g,"\\'")}')">×</button></div>`).join('');
}

export async function addHomeCategory(){
  const inp=document.getElementById('newCatInput') as HTMLInputElement;
  const val=inp.value.trim();
  if(!val){toast('⚠️ Enter a category name');return;}
  if(homeCategories.includes(val)){toast('⚠️ Already exists');return;}
  homeCategories.push(val);
  inp.value='';
  await saveSettings();
  renderAdminCategories();
  rebuildCategoryDropdowns();
  toast('✅ Category added');
}

export async function removeCat(c: string) {
  if(!(await confirmDialog(`Remove "${c}"?`))) return;
  setHomeCategories(homeCategories.filter(x=>x!==c));
  await saveSettings();
  renderAdminCategories();
  rebuildCategoryDropdowns();
  toast('🗑 Category removed');
}

export function renderAdminServiceTypes(){
  const list=document.getElementById('adminServiceList');
  if(!list) return;
  list.innerHTML=serviceTypes.map(s=>`
    <div class="tag-chip">🔧 ${s}<button onclick="removeService('${s.replace(/'/g,"\\'")}')">×</button></div>`).join('');
}

export async function addServiceType(){
  const inp=document.getElementById('newServiceInput') as HTMLInputElement;
  const val=inp.value.trim();
  if(!val){toast('⚠️ Enter a service type');return;}
  if(serviceTypes.includes(val)){toast('⚠️ Already exists');return;}
  serviceTypes.push(val);
  inp.value='';
  await saveSettings();
  renderAdminServiceTypes();
  rebuildServiceDropdowns();
  toast('✅ Service type added');
}

export async function removeService(s: string) {
  if(!(await confirmDialog(`Remove "${s}"?`))) return;
  setServiceTypes(serviceTypes.filter(x=>x!==s));
  await saveSettings();
  renderAdminServiceTypes();
  rebuildServiceDropdowns();
  toast('🗑 Service type removed');
}

export function renderAdminEventTypes(){
  const list=document.getElementById('adminEventTypeList');
  if(!list) return;
  list.innerHTML=eventTypes.map((t,i)=>`
    <div class="tag-chip">${t.emoji} ${t.label}<button onclick="delEventType(${i})">×</button></div>`).join('');
}

export function rebuildEventTypeDropdown(){
  const el=document.getElementById('cType') as HTMLSelectElement;
  if(!el) return;
  const cur=el.value;
  el.innerHTML=eventTypes.map(t=>`<option value="${esc(t.value)}">${esc(t.emoji)} ${esc(t.label)}</option>`).join('');
  if(cur) el.value=cur;
}

export async function addEventType(){
  const emoji=((document.getElementById('newEventTypeEmoji') as HTMLInputElement)?.value||'').trim()||'📌';
  const label=((document.getElementById('newEventTypeLabel') as HTMLInputElement)?.value||'').trim();
  if(!label){toast('⚠️ Enter a label');return;}
  const value=label.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
  if(eventTypes.find(t=>t.value===value)){toast('⚠️ Already exists');return;}
  eventTypes.push({value,emoji,label});
  if(document.getElementById('newEventTypeLabel')) (document.getElementById('newEventTypeLabel') as HTMLInputElement).value='';
  if(document.getElementById('newEventTypeEmoji')) (document.getElementById('newEventTypeEmoji') as HTMLInputElement).value='';
  await saveSettings();
  renderAdminEventTypes();
  rebuildEventTypeDropdown();
  toast('✅ Event type added');
}

export async function delEventType(i: number) {
  if(!(await confirmDialog('Remove this event type?'))) return;
  eventTypes.splice(i,1);
  await saveSettings();
  renderAdminEventTypes();
  rebuildEventTypeDropdown();
  toast('🗑 Event type removed');
}
