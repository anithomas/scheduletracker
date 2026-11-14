// ─── AUTH ─────────────────────────────────────────────────────
import { auth, db, firebase } from './firebase-init';
import { toast } from './utils';
import { unsubs, setUnsubs } from './save-guards';
import { appConfig } from './settings';
import { loadSettingsForAuth, checkUserAccess, applyRBAC, _storedAccessRoles, setStoredAccessRoles } from './rbac';
import { buildAccessRoles, sameAccessRoles, loadSettings } from './vehicles';
import { startListeners } from './listeners';
import { confirmDialog } from './dialogs';

export function signInWithGoogle() {
  const p = new firebase.auth.GoogleAuthProvider();
  p.addScope('email');
  p.addScope('profile');
  // Native (Capacitor) WebView blocks popups — use redirect instead
  if ((window as any).Capacitor) {
    auth.signInWithRedirect(p).catch((e: any) => toast('❌ Sign-in error: ' + e.message));
  } else {
    auth.signInWithPopup(p).catch((e: any) => toast('❌ Sign-in error: ' + e.message));
  }
}
// Handle redirect result on app load (native sign-in completes here)
auth.getRedirectResult().catch(() => {});

export async function signOut() {
  if (!(await confirmDialog('Sign out?'))) return;
  unsubs.forEach(u=>u()); setUnsubs([]);
  auth.signOut();
}

auth.onAuthStateChanged(async user => {
  document.getElementById('appLoading')!.style.display = 'none';
  document.getElementById('accessDenied')!.style.display = 'none';
  if (user) {
    await loadSettingsForAuth();
    const role = await checkUserAccess(user);
    if (role === 'denied') {
      document.getElementById('deniedEmail')!.textContent = user.email || '';
      document.getElementById('appShell')!.classList.remove('app-visible');
      document.getElementById('loginScreen')!.style.display = 'none';
      document.getElementById('accessDenied')!.style.display = 'flex';
      return;
    }
    document.getElementById('loginScreen')!.style.display = 'none';
    document.getElementById('appShell')!.classList.add('app-visible');
    document.getElementById('userName')!.textContent = user.displayName?.split(' ')[0]||user.email;
    const av = document.getElementById('userAvatar') as HTMLImageElement;
    if (user.photoURL) { av.src = user.photoURL; av.style.display = ''; } else { av.removeAttribute('src'); av.style.display = 'none'; }
    applyRBAC(role);
    if (role === 'admin' && !sameAccessRoles(_storedAccessRoles, buildAccessRoles(appConfig.authorizedUsers))) {
      db.collection('settings').doc('config')
        .set({ accessRoles: buildAccessRoles(appConfig.authorizedUsers) }, { merge: true })
        .then(() => { setStoredAccessRoles(buildAccessRoles(appConfig.authorizedUsers)); })
        .catch(e => console.warn('accessRoles sync failed', e));
    }
    startListeners();
    loadSettings();
  } else {
    document.getElementById('appShell')!.classList.remove('app-visible');
    document.getElementById('loginScreen')!.style.display = 'flex';
  }
});
