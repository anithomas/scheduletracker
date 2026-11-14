// ─── IN-APP DIALOGS (Phase 3, R7) ──────────────────────────────
// Replaces the browser's alert()/confirm()/prompt() — which block the whole
// tab, can't be styled, and get silently suppressed by some mobile/PWA
// contexts — with small accessible modal dialogs built from the same
// .modal-overlay/.modal markup and CSS the rest of the app already uses.
// Each function returns a Promise so call sites that used to read
// confirm()'s/prompt()'s synchronous return value just add `await`.
import { esc } from './html-escape';

let _lastFocused: HTMLElement | null = null;
let _dialogScrollY = 0;

function lockBody() {
  _dialogScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.top = `-${_dialogScrollY}px`;
  document.body.classList.add('modal-open');
}
function unlockBody() {
  document.body.classList.remove('modal-open');
  document.body.style.top = '';
  window.scrollTo(0, _dialogScrollY);
}

function buildOverlay(): { overlay: HTMLDivElement; box: HTMLDivElement } {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.width = '420px';
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  lockBody();
  return { overlay, box };
}

function closeOverlay(overlay: HTMLDivElement) {
  overlay.remove();
  unlockBody();
  if (_lastFocused && typeof _lastFocused.focus === 'function') _lastFocused.focus();
  _lastFocused = null;
}

function trapFocus(box: HTMLDivElement, onEscape: () => void) {
  const focusable = () => Array.from(
    box.querySelectorAll<HTMLElement>('button, input, textarea, [href], [tabindex]:not([tabindex="-1"])')
  ).filter(el => !el.hasAttribute('disabled'));
  box.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/** Replaces confirm(message) — resolves true/false instead of returning it. */
export function confirmDialog(message: string, opts: { okLabel?: string; cancelLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  const okLabel = opts.okLabel || 'OK';
  const cancelLabel = opts.cancelLabel || 'Cancel';
  _lastFocused = document.activeElement as HTMLElement;
  return new Promise(resolve => {
    const { overlay, box } = buildOverlay();
    const titleId = 'dlg-msg-' + Date.now();
    box.innerHTML = `
      <p id="${titleId}" style="margin:0 0 20px;white-space:pre-wrap">${esc(message)}</p>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn btn-primary" style="${opts.danger ? 'background:var(--red);border-color:var(--red)' : ''}" data-act="ok">${esc(okLabel)}</button>
      </div>`;
    box.setAttribute('aria-labelledby', titleId);
    const finish = (val: boolean) => { closeOverlay(overlay); resolve(val); };
    box.querySelector('[data-act="ok"]')!.addEventListener('click', () => finish(true));
    box.querySelector('[data-act="cancel"]')!.addEventListener('click', () => finish(false));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(false); });
    trapFocus(box, () => finish(false));
    (box.querySelector('[data-act="ok"]') as HTMLElement).focus();
  });
}

/** Replaces prompt(message, defaultValue) — resolves the entered string, or null on cancel. */
export function promptDialog(message: string, defaultValue = ''): Promise<string | null> {
  _lastFocused = document.activeElement as HTMLElement;
  return new Promise(resolve => {
    const { overlay, box } = buildOverlay();
    const titleId = 'dlg-msg-' + Date.now();
    const inputId = 'dlg-input-' + Date.now();
    box.innerHTML = `
      <p id="${titleId}" style="margin:0 0 10px;white-space:pre-wrap">${esc(message)}</p>
      <div class="form-group" style="margin-bottom:20px">
        <input id="${inputId}" type="text" value="${esc(defaultValue)}" />
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-act="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-act="ok">OK</button>
      </div>`;
    box.setAttribute('aria-labelledby', titleId);
    const input = box.querySelector('#' + inputId) as HTMLInputElement;
    const finish = (val: string | null) => { closeOverlay(overlay); resolve(val); };
    box.querySelector('[data-act="ok"]')!.addEventListener('click', () => finish(input.value));
    box.querySelector('[data-act="cancel"]')!.addEventListener('click', () => finish(null));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } });
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(null); });
    trapFocus(box, () => finish(null));
    input.focus();
    input.select();
  });
}
