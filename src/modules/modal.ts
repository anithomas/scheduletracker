// ─── MODAL ────────────────────────────────────────
import { _savingModals, _saveBtn } from './save-guards';
import { buildEventMemberPicker } from './member-prefs';
import { appConfig } from './settings';

let _modalScrollY = 0;
export function openModal(id: string){
  // Defensive reset: if a previous save on this modal never completed (e.g. the
  // network write hung, or the tab was backgrounded mid-save on a phone), the
  // Save button could be left disabled/"Saving…" forever. Opening the modal
  // again always self-heals that, regardless of what caused it.
  if (typeof _savingModals !== 'undefined' && _savingModals.has(id)) {
    const stuckBtn = _savingModals.get(id);
    _savingModals.delete(id);
    if (stuckBtn) {
      stuckBtn.disabled = false;
      if (stuckBtn.dataset.prevLabel) { stuckBtn.textContent = stuckBtn.dataset.prevLabel; delete stuckBtn.dataset.prevLabel; }
    }
  }
  // Belt-and-braces: also reset any button matching the save-button pattern,
  // in case it lost its dataset (e.g. a re-render replaced the element).
  const _sb = (typeof _saveBtn === 'function') ? _saveBtn(id) : null;
  const _defaultLabel = ({ calModal: '💾 Save Event', autoModal: '💾 Save Record', homeModal: '💾 Save Item' } as Record<string,string>)[id];
  if (_sb) {
    _sb.disabled = false;
    if (_sb.dataset.prevLabel) { _sb.textContent = _sb.dataset.prevLabel; delete _sb.dataset.prevLabel; }
    else if (/^⏳/.test(_sb.textContent||'') && _defaultLabel) { _sb.textContent = _defaultLabel; }
  }
  // Delete only makes sense once something exists to delete — editEvent() sets
  // calEditId before opening, openCalDay()/the bare "+ Add Event" button leave
  // it empty, and closeModal() always clears it, so this reads reliably no
  // matter which entry point opened the modal.
  if(id==='calModal'){
    const delBtn=document.getElementById('calDeleteBtn');
    if(delBtn) delBtn.style.display = (document.getElementById('calEditId') as HTMLInputElement).value ? '' : 'none';
  }
  // Save scroll position then lock body — preserves position without viewport jump
  _modalScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${_modalScrollY}px`;
  document.body.classList.add('modal-open');
  const overlay = document.getElementById(id)!;
  overlay.classList.add('open');
  // Scroll modal content to top
  const m = overlay.querySelector('.modal');
  if(m) m.scrollTop = 0;
}
export function closeModal(id: string){
  document.getElementById(id)!.classList.remove('open');
  // Restore body scroll position
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, _modalScrollY);
  const editMap: Record<string,string> = {autoModal:'autoEditId',homeModal:'homeEditId',calModal:'calEditId',adminVehicleModal:'vehicleCfgId',adminMemberModal:'memberCfgId'};
  if(editMap[id]){
    const el = document.getElementById(editMap[id]) as HTMLInputElement;
    el.value='';
    el.dataset.existingUrl='';
    el.dataset.existingUrls='[]';
  }
  // Text/date/number/etc. inputs reset via .value; checkboxes and radios store
  // their state in .checked, not .value — setting .value='' on a checkbox
  // actually overwrites its value ATTRIBUTE (e.g. wiping "ANI Thomas" to ""),
  // corrupting the member picker for the next time this modal opens via any
  // entry point that doesn't rebuild it (like the top-nav "+ Add" buttons).
  document.getElementById(id)!.querySelectorAll<HTMLInputElement>('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea').forEach(el=>el.value='');
  document.getElementById(id)!.querySelectorAll<HTMLInputElement>('input[type=checkbox],input[type=radio]').forEach(el=>el.checked=false);
  // Rebuild the member/notify picker from scratch so it can never carry stale
  // checked-state or corrupted values into the next open, regardless of which
  // button opens the modal next.
  if (id === 'calModal' && typeof buildEventMemberPicker === 'function') buildEventMemberPicker([], []);
  ['aHstBox','hHstBox'].forEach(bid=>{const b=document.getElementById(bid);if(b)b.classList.remove('visible');});
  ['aKmBox'].forEach(bid=>{const b=document.getElementById(bid);if(b)b.classList.remove('visible');});
  ['aFilePreview','hFilePreview','aExistingFile','hExistingFile'].forEach(pid=>{const p=document.getElementById(pid);if(p)p.innerHTML='';});
  ['aTotalEdit','hTotalEdit'].forEach(eid=>{const el=document.getElementById(eid) as HTMLInputElement;if(el)el.dataset.manualOverride='';});
  const aTax=document.getElementById('aTaxRate') as HTMLInputElement; if(aTax&&!aTax.dataset.userSet) aTax.value=String(appConfig.defaultTaxRate);
  const hTax=document.getElementById('hTaxRate') as HTMLInputElement; if(hTax&&!hTax.dataset.userSet) hTax.value=String(appConfig.defaultTaxRate);
}
