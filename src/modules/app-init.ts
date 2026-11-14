// ─── APP INIT (Phase 3 / S5) ────────────────────────────────────
// These two bits of page-setup used to be their own inline <script> tags at
// the bottom of index.html (the "about" build badge, and service-worker
// registration). Folding them into a real module lets the new CSP meta tag
// in index.html's <head> use a strict script-src 'self' with no
// 'unsafe-inline' — an inline <script> with no nonce would otherwise be
// silently blocked by that policy.
import { _savingModals } from './save-guards';

export function initAboutBadge() {
  const y = new Date().getFullYear();
  const el = document.getElementById('aboutBuildBadge');
  if (el) el.textContent = '✨ Built with Claude AI · ' + y;
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');

      // Actively check for a newer sw.js on every load rather than waiting
      // for the browser's own (up to ~24h) background check. This is what
      // makes a fresh deploy actually reach open tabs promptly.
      reg.update().catch(() => {});

      // If a new worker finishes installing while this tab is open, activate
      // it immediately instead of leaving it "waiting" until every tab with
      // the old version happens to close — which is what silently stranded
      // users on stale JS after a deploy.
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage('SKIP_WAITING');
          }
        });
      });
    } catch (e) { /* SW registration failure shouldn't block the app */ }
  });

  // The new worker's 'activate' handler messages every open tab once it has
  // taken control. Reload so the tab actually runs the new code instead of
  // continuing to execute the old JS that's already loaded in memory.
  let _swReloaded = false;
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if (e.data && e.data.type === 'SW_UPDATED' && !_swReloaded) {
      _swReloaded = true;
      // Avoid interrupting an in-progress save: wait for any beginSave()
      // guard to clear before reloading.
      const trySafeReload = () => {
        if (_savingModals.size > 0) {
          setTimeout(trySafeReload, 1000);
        } else {
          location.reload();
        }
      };
      trySafeReload();
    }
  });
}
