// ─── RBAC ─────────────────────────────────────────────────────
import { db, auth } from './firebase-init';
import { esc, escJs } from './html-escape';
import { toast } from './utils';
import { appConfig, setCurrentUserRole } from './settings';
import { getInitials } from './display-names';
import { saveSettings } from './vehicles';
import { showSection } from './section-nav';
import { confirmDialog } from './dialogs';

export let _storedAccessRoles: Record<string, string> | null = null;
export function setStoredAccessRoles(v: Record<string, string> | null) { _storedAccessRoles = v; }

export async function loadSettingsForAuth() {
  try {
    const doc = await db.collection('settings').doc('config').get();
    if (doc.exists && doc.data()!.authorizedUsers) appConfig.authorizedUsers = doc.data()!.authorizedUsers;
    _storedAccessRoles = doc.exists ? (doc.data()!.accessRoles || null) : null;
  } catch(e) {
    // Non-members can't read settings once firestore.rules are deployed;
    // leaving authorizedUsers empty makes checkUserAccess() deny them.
  }
}

export async function checkUserAccess(user: any) {
  // No "first sign-in becomes admin" bootstrap: if the access list is ever
  // empty or unreadable, everyone is denied. Recover by adding an admin to
  // settings/config in the Firebase console (see SECURITY.md).
  const users = appConfig.authorizedUsers || [];
  const entry: any = users.find((u: any) => u.email.toLowerCase() === user.email.toLowerCase());
  return entry ? (entry.role||'viewer') : 'denied'; // unknown users are DENIED, not viewers
}

export function applyRBAC(role: string) {
  setCurrentUserRole(role);
  const shell = document.getElementById('appShell')!;
  shell.classList.remove('role-admin','role-contributor','role-viewer','role-denied');
  shell.classList.add('role-' + role);
  const badge = document.getElementById('roleBadge');
  if (badge) {
    if (role !== 'admin') { badge.textContent = role; badge.className = 'role-badge ' + role; (badge as HTMLElement).style.display = ''; }
    else (badge as HTMLElement).style.display = 'none';
  }
  // If contributor/viewer is on admin section, redirect
  if (role !== 'admin') {
    const adminEl = document.getElementById('admin');
    if (adminEl?.classList.contains('active')) showSection('calendar', document.querySelector('nav button') as HTMLElement);
  }
}

export function renderUserAccess() {
  const list = document.getElementById('userAccessList');
  if (!list) return;
  const users: any[] = appConfig.authorizedUsers || [];
  if (!users.length) {
    list.innerHTML = '<div class="empty-state" style="padding:16px"><div class="empty-icon">👤</div><p>No users yet</p></div>';
    return;
  }
  const allNames = users.map(u => u.name||u.email);
  const COLORS = ['#0b1f3a','#e76f51','#d9a441','#2c8a5d','#071427','#a03d24','#96690f','#1f6f4a'];
  const self = auth.currentUser?.email?.toLowerCase();
  list.innerHTML = users.map((u,i) => {
    const initials = getInitials(u.name||u.email, allNames);
    const isSelf = self && u.email.toLowerCase()===self;
    const selfAdmin = isSelf && u.role==='admin';
    return `<div class="user-access-item">
      <div class="ua-avatar" style="background:${COLORS[i%COLORS.length]}">${esc(initials)}</div>
      <div class="ua-info">
        <div class="ua-name">${esc(u.name||u.email)}${isSelf?' <span style="font-size:.68rem;opacity:.6">(you)</span>':''}</div>
        <div class="ua-email">${esc(u.email)}</div>
      </div>
      <select class="role-select" onchange="setUserRole('${escJs(u.email)}',this.value)" ${selfAdmin?'disabled title="Cannot demote yourself as last admin"':''}>
        <option value="admin" ${u.role==='admin'?'selected':''}>👑 Admin</option>
        <option value="contributor" ${u.role==='contributor'?'selected':''}>✏️ Contributor</option>
        <option value="viewer" ${u.role==='viewer'?'selected':''}>👁 Viewer</option>
        <option value="denied" ${u.role==='denied'?'selected':''}>🚫 Denied</option>
      </select>
      ${!selfAdmin?`<button class="btn-icon btn-del" onclick="removeAuthorizedUser('${escJs(u.email)}')" title="Remove">🗑</button>`:''}
    </div>`;
  }).join('');
}

export async function addAuthorizedUser() {
  const email = ((document.getElementById('newUserEmail') as HTMLInputElement).value||'').trim().toLowerCase();
  const role  = (document.getElementById('newUserRole') as HTMLSelectElement).value;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('⚠️ Enter a valid email'); return; }
  const users: any[] = appConfig.authorizedUsers || [];
  if (users.find(u=>u.email.toLowerCase()===email)) { toast('⚠️ User already in list'); return; }
  users.push({email, name:email.split('@')[0], role, addedAt:new Date().toISOString()});
  appConfig.authorizedUsers = users;
  await saveSettings();
  renderUserAccess();
  (document.getElementById('newUserEmail') as HTMLInputElement).value='';
  toast('✅ User added');
}

export async function removeAuthorizedUser(email: string) {
  if (!(await confirmDialog('Remove this user?'))) return;
  const users: any[] = appConfig.authorizedUsers||[];
  const admins = users.filter(u=>u.role==='admin');
  if (admins.length===1 && admins[0].email.toLowerCase()===email.toLowerCase()) { toast('⚠️ Cannot remove last admin'); return; }
  appConfig.authorizedUsers = users.filter(u=>u.email.toLowerCase()!==email.toLowerCase());
  await saveSettings(); renderUserAccess(); toast('🗑 User removed');
}

export async function setUserRole(email: string, role: string) {
  const users: any[] = appConfig.authorizedUsers||[];
  if (role!=='admin') {
    const admins=users.filter(u=>u.role==='admin');
    const target=users.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if (admins.length===1 && target?.role==='admin') { toast('⚠️ Cannot remove last admin role'); return; }
  }
  const u=users.find(u=>u.email.toLowerCase()===email.toLowerCase());
  if (u) { u.role=role; u.updatedAt=new Date().toISOString(); }
  await saveSettings(); renderUserAccess(); toast('✅ Role updated');
}
