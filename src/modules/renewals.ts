// ─── RENEWALS (Phase 4, F2) ─────────────────────────────────────
// Expiry dates for insurance, licences, plate stickers, warranties — dates
// and a short note only. Deliberately no field for a policy or ID number
// (see firestore.rules): the point of this feature is "when does it expire",
// not a place to store the number itself.
import { db, auth, firebase } from './firebase-init';
import { esc, escJs } from './html-escape';
import { renewals } from './save-guards';
import { statusBadge, fmt } from './utils';
import { durLabel } from './tax';
import { appVehicles, appMembers } from './settings';
import { vehicleDisplayName, memberDisplayName } from './display-names';
import { isRecurring, markDone } from './mark-done';
import { openModal, closeModal } from './modal';
import { confirmDialog } from './dialogs';
import { toast } from './utils';
import { withTimeout, friendlyError, beginSave, endSave } from './save-guards';

export const RENEWAL_CAT_ICONS: Record<string, string> = {
  insurance: '🛡️', licence: '🪪', plate: '🚘', warranty: '📄', other: '🔖',
};
export const RENEWAL_CAT_LABELS: Record<string, string> = {
  insurance: 'Insurance', licence: 'Licence', plate: 'Plate Sticker', warranty: 'Warranty', other: 'Other',
};

function renewalFor(r: any): string {
  if (r.vehicleId) {
    const v = appVehicles.find(x => x.id === r.vehicleId);
    if (v) return `${esc(v.emoji || '🚗')} ${esc(vehicleDisplayName(v))}`;
  }
  if (r.assignedTo) {
    const m = appMembers.find(x => x.name === r.assignedTo);
    return m
      ? `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:8px;height:8px;border-radius:50%;background:${esc(m.color)};display:inline-block"></span>${esc(memberDisplayName(m))}</span>`
      : esc(r.assignedTo);
  }
  return '<span style="color:var(--gray-400)">Household</span>';
}

export function renderRenewals() {
  const body = document.getElementById('renewalBody');
  if (!body) return;
  const sorted = [...renewals].sort((a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));
  body.innerHTML = sorted.map(r => `
    <tr>
      <td><div class="td-main">${RENEWAL_CAT_ICONS[r.category] || '🔖'} ${esc(r.title)}</div>${r.notes ? `<div class="td-sub">${esc(r.notes)}</div>` : ''}</td>
      <td><span class="type-badge type-general">${esc(RENEWAL_CAT_LABELS[r.category] || r.category || 'Other')}</span></td>
      <td>${renewalFor(r)}</td>
      <td>${fmt(r.nextDate)}</td>
      <td>${r.durVal ? esc(durLabel(r.durVal, r.durUnit)) : '<span style="color:var(--gray-400)">One-time</span>'}</td>
      <td>${statusBadge(r.nextDate, r.completed)}</td>
      <td><div class="btn-actions">
        <button class="btn-icon btn-done${r.completed ? ' is-complete' : ''}" onclick="toggleRenewalDone('${escJs(r.id)}')" title="${r.completed ? 'Mark as not done' : isRecurring(r) ? 'Mark renewed — schedules the next one' : 'Mark renewed'}">${r.completed ? '✅' : '⬜'}</button>
        <button class="btn-icon btn-edit" onclick="editRenewal('${escJs(r.id)}')" title="Edit">✏️</button>
        <button class="btn-icon btn-del" onclick="delRenewal('${escJs(r.id)}')" title="Delete">🗑</button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🔖</div><p>No renewals tracked yet</p></div></td></tr>`;
}

export function rebuildRenewalDropdowns() {
  const vOpts = '<option value="">— None —</option>' + appVehicles.map(v => `<option value="${v.id}">${v.emoji || '🚗'} ${vehicleDisplayName(v)}</option>`).join('');
  const vEl = document.getElementById('rwVehicle') as HTMLSelectElement;
  if (vEl) { const cur = vEl.value; vEl.innerHTML = vOpts; if (cur) vEl.value = cur; }
  const mOpts = '<option value="">— Household (shared) —</option>' + appMembers.map(m => `<option value="${m.name}">${memberDisplayName(m)}</option>`).join('');
  const mEl = document.getElementById('rwAssignee') as HTMLSelectElement;
  if (mEl) { const cur = mEl.value; mEl.innerHTML = mOpts; if (cur) mEl.value = cur; }
}

export function toggleRenewalAuto(cb: HTMLInputElement) {
  const wrap = document.getElementById('rwIntervalWrap');
  if (wrap) (wrap as HTMLElement).style.display = cb.checked ? 'flex' : 'none';
}

export async function toggleRenewalDone(id: string) {
  const r = renewals.find(x => x.id === id);
  if (r) await markDone('renewals', r);
}

export function editRenewal(id: string) {
  const r: any = renewals.find(x => x.id === id);
  (document.getElementById('renewalEditId') as HTMLInputElement).value = r?.id || '';
  (document.getElementById('rwTitle') as HTMLInputElement).value = r?.title || '';
  (document.getElementById('rwCategory') as HTMLSelectElement).value = r?.category || 'insurance';
  (document.getElementById('rwVehicle') as HTMLSelectElement).value = r?.vehicleId || '';
  (document.getElementById('rwAssignee') as HTMLSelectElement).value = r?.assignedTo || '';
  (document.getElementById('rwLastDate') as HTMLInputElement).value = r?.lastDate || '';
  (document.getElementById('rwNextDate') as HTMLInputElement).value = r?.nextDate || '';
  const autoCb = document.getElementById('rwAuto') as HTMLInputElement;
  autoCb.checked = !!r?.durVal;
  (document.getElementById('rwDurVal') as HTMLInputElement).value = r?.durVal || '1';
  (document.getElementById('rwDurUnit') as HTMLSelectElement).value = r?.durUnit || 'years';
  toggleRenewalAuto(autoCb);
  (document.getElementById('rwNotes') as HTMLInputElement).value = r?.notes || '';
  openModal('renewalModal');
}

export async function saveRenewal() {
  const id = (document.getElementById('renewalEditId') as HTMLInputElement).value;
  const title = ((document.getElementById('rwTitle') as HTMLInputElement).value || '').trim();
  const nextDate = (document.getElementById('rwNextDate') as HTMLInputElement).value;
  if (!title) { toast('⚠️ Please enter a title'); (document.getElementById('rwTitle') as HTMLInputElement).focus(); return; }
  if (!nextDate) { toast('⚠️ Please enter the expiry date'); (document.getElementById('rwNextDate') as HTMLInputElement).focus(); return; }
  const lastDate = (document.getElementById('rwLastDate') as HTMLInputElement).value;
  if (lastDate && lastDate > nextDate) { toast('⚠️ Expiry date cannot be before the last renewed date'); return; }
  const isAuto = (document.getElementById('rwAuto') as HTMLInputElement).checked;

  if (!beginSave('renewalModal')) return;
  try {
    const rec: any = {
      title,
      category: (document.getElementById('rwCategory') as HTMLSelectElement).value,
      vehicleId: (document.getElementById('rwVehicle') as HTMLSelectElement).value || null,
      assignedTo: (document.getElementById('rwAssignee') as HTMLSelectElement).value || null,
      lastDate: lastDate || null,
      nextDate,
      durVal: isAuto ? (document.getElementById('rwDurVal') as HTMLInputElement).value : null,
      durUnit: isAuto ? (document.getElementById('rwDurUnit') as HTMLSelectElement).value : null,
      notes: (document.getElementById('rwNotes') as HTMLInputElement).value || '',
      updatedBy: auth.currentUser?.displayName || '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (id) await withTimeout(db.collection('renewals').doc(id).set(rec, { merge: true }));
    else await withTimeout(db.collection('renewals').add({ ...rec, completed: false }));
    closeModal('renewalModal');
    toast('✅ Renewal saved!');
  } catch (err) {
    console.error('saveRenewal failed:', err);
    toast('❌ Could not save: ' + friendlyError(err));
  } finally {
    endSave('renewalModal');
  }
}

export async function delRenewal(id: string) {
  if (!(await confirmDialog('Delete this renewal?'))) return;
  try {
    await db.collection('renewals').doc(id).delete();
    toast('🗑 Renewal deleted');
  } catch (err) {
    console.error('delRenewal failed:', err);
    toast('❌ Could not delete: ' + friendlyError(err));
  }
}
