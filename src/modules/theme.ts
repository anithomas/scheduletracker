// ─── DARK MODE (Phase 4, F11) ───────────────────────────────────
// The actual color flip lives entirely in index.html's CSS (a handful of
// neutral/page-chrome custom properties, overridden under
// `:root[data-theme="dark"]` and under `@media (prefers-color-scheme: dark)`
// for anyone who hasn't made an explicit choice yet). This module only
// decides WHICH of light/dark/"follow the OS" is in effect, persists an
// explicit choice, and keeps the toggle button's icon in sync.
//
// There's no flash-of-wrong-theme guard here: this app's Content-Security-
// -Policy has no 'unsafe-inline' for script-src (see index.html's CSP
// comment), so the usual "tiny inline <script> in <head>, before any CSS"
// trick to set the attribute pre-paint isn't available — every script has
// to be this origin's bundle, loaded as a module after the DOM exists. In
// the common case (no saved override) that's a non-issue: the dark-mode
// media query above is pure CSS and applies before this module ever runs,
// so there's nothing to "catch up" on. A brief flash is only even possible
// when a saved override disagrees with the OS setting (e.g. OS is light,
// user explicitly chose dark) — an edge case judged acceptable for an
// "Effort: S" feature rather than a reason to restructure the CSP.
const STORAGE_KEY = 'tracker-theme';

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

// The theme actually in effect right now: an explicit saved choice if there
// is one, otherwise whatever the OS is currently set to.
function effectiveTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return systemPrefersDark() ? 'dark' : 'light';
}

function updateToggleButton(theme: 'light' | 'dark') {
  const icon = document.getElementById('themeToggleIcon');
  const label = document.getElementById('themeToggleLabel');
  const btn = document.getElementById('themeToggleBtn');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'dark' ? ' Light' : ' Dark';
  if (btn) {
    const next = theme === 'dark' ? 'light' : 'dark';
    btn.title = `Switch to ${next} mode`;
    btn.setAttribute('aria-label', `Switch to ${next} mode`);
  }
}

// Called once, early, on every load. Only sets the `data-theme` attribute
// when there's an explicit saved choice to honor — otherwise leaves it
// unset so the CSS media query (not this code) decides, which is what lets
// the OS's own light/dark switch (e.g. a scheduled night mode) keep working
// live for anyone who's never touched the toggle.
export function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
  updateToggleButton(effectiveTheme());
}

export function toggleTheme() {
  const next: 'light' | 'dark' = effectiveTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem(STORAGE_KEY, next);
  document.documentElement.setAttribute('data-theme', next);
  updateToggleButton(next);
}
