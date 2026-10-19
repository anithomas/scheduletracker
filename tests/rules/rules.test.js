// Security-rules tests for firestore.rules and storage.rules.
// Run: cd tests/rules && npm ci && npm test   (needs Java for the emulators)
import { readFileSync } from 'node:fs';
import { test, before, after, beforeEach } from 'node:test';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const ROOT = new URL('../../', import.meta.url);
let env;

const USERS = {
  admin:       { uid: 'u-admin',  email: 'ani@example.com' },
  contributor: { uid: 'u-contrib', email: 'anju@example.com' },
  viewer:      { uid: 'u-viewer', email: 'rachel@example.com' },
  denied:      { uid: 'u-denied', email: 'old@example.com' },
  stranger:    { uid: 'u-strange', email: 'someone@example.com' },
};

const CONFIG = {
  appName: 'Family Household Tracker',
  members: [{ id: 'm1', name: 'Ani' }, { id: 'm2', name: 'Anju' }],
  authorizedUsers: [
    { email: 'Ani@example.com', role: 'admin' },
    { email: 'anju@example.com', role: 'contributor' },
    { email: 'rachel@example.com', role: 'viewer' },
    { email: 'old@example.com', role: 'denied' },
  ],
  accessRoles: {
    'ani@example.com': 'admin',
    'anju@example.com': 'contributor',
    'rachel@example.com': 'viewer',
    'old@example.com': 'denied',
  },
};

const as = (who, { verified = true, emailOverride } = {}) => {
  const u = USERS[who];
  return env.authenticatedContext(u.uid, {
    email: emailOverride ?? u.email, email_verified: verified,
  });
};
const db = (ctx) => ctx.firestore();
const st = (ctx) => ctx.storage();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-tracker',
    firestore: { rules: readFileSync(new URL('firestore.rules', ROOT), 'utf8'), host: '127.0.0.1', port: 8080 },
    storage:   { rules: readFileSync(new URL('storage.rules', ROOT), 'utf8'),   host: '127.0.0.1', port: 9199 },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'settings/config'), CONFIG);
    await setDoc(doc(ctx.firestore(), 'events/e1'), { title: 'Dentist', date: '2026-10-20' });
    await uploadBytes(ref(ctx.storage(), 'receipts/u-contrib/auto_1_receipt.png'),
      new Uint8Array([1, 2, 3]), { contentType: 'image/png' });
  });
});

// ---------- settings/config ----------
test('signed-out users cannot read config', async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'settings/config')));
});
test('strangers and denied users cannot read config or data', async () => {
  for (const who of ['stranger', 'denied']) {
    await assertFails(getDoc(doc(db(as(who)), 'settings/config')));
    await assertFails(getDoc(doc(db(as(who)), 'events/e1')));
  }
});
test('unverified email is treated as no access', async () => {
  await assertFails(getDoc(doc(db(as('admin', { verified: false })), 'settings/config')));
});
test('email match is case-insensitive', async () => {
  await assertSucceeds(getDoc(doc(db(as('admin', { emailOverride: 'ANI@Example.com' })), 'settings/config')));
});
test('all members can read config', async () => {
  for (const who of ['admin', 'contributor', 'viewer']) {
    await assertSucceeds(getDoc(doc(db(as(who)), 'settings/config')));
  }
});
test('nobody can create config from the app (no bootstrap-to-admin)', async () => {
  await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'settings/config')));
  await assertFails(setDoc(doc(db(as('stranger')), 'settings/config'), {
    accessRoles: { 'someone@example.com': 'admin' },
  }));
});
test('admin can change settings', async () => {
  await assertSucceeds(updateDoc(doc(db(as('admin')), 'settings/config'), { appName: 'Thomas Home' }));
});
test('admin cannot leave the household with no admin', async () => {
  await assertFails(updateDoc(doc(db(as('admin')), 'settings/config'), {
    accessRoles: { 'ani@example.com': 'viewer' },
  }));
});
test('non-admins can update only members', async () => {
  for (const who of ['contributor', 'viewer']) {
    await assertSucceeds(updateDoc(doc(db(as(who)), 'settings/config'), {
      members: [{ id: 'm1', name: 'Ani', fcmTokens: ['t'] }], updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(db(as(who)), 'settings/config'), { appName: 'Hacked' }));
  }
});
test('viewer cannot grant themselves admin', async () => {
  await assertFails(updateDoc(doc(db(as('viewer')), 'settings/config'), {
    accessRoles: { ...CONFIG.accessRoles, 'rachel@example.com': 'admin' },
  }));
});

// ---------- data collections ----------
for (const col of ['events', 'autoRecords', 'homeItems']) {
  test(`${col}: contributor and admin can create/update/delete`, async () => {
    for (const who of ['contributor', 'admin']) {
      const c = db(as(who));
      const r = await assertSucceeds(addDoc(collection(c, col), { title: 'x' }));
      await assertSucceeds(updateDoc(r, { title: 'y' }));
      await assertSucceeds(deleteDoc(r));
    }
  });
  test(`${col}: viewer can read but not write`, async () => {
    const c = db(as('viewer'));
    await assertSucceeds(getDoc(doc(c, col, 'e1')));
    await assertFails(addDoc(collection(c, col), { title: 'x' }));
  });
}
test('unknown collections are closed', async () => {
  await assertFails(setDoc(doc(db(as('admin')), 'other/x'), { a: 1 }));
  await assertFails(getDoc(doc(db(as('admin')), 'other/x')));
});

// ---------- storage ----------
const png = new Uint8Array([137, 80, 78, 71]);
test('storage: contributor can upload to own folder only', async () => {
  const s = st(as('contributor'));
  await assertSucceeds(uploadBytes(ref(s, 'receipts/u-contrib/home_2_bill.png'), png, { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(s, 'receipts/u-admin/home_2_bill.png'), png, { contentType: 'image/png' }));
});
test('storage: viewer can read but not upload', async () => {
  const s = st(as('viewer'));
  await assertSucceeds(getBytes(ref(s, 'receipts/u-contrib/auto_1_receipt.png')));
  await assertFails(uploadBytes(ref(s, 'receipts/u-viewer/a.png'), png, { contentType: 'image/png' }));
});
test('storage: strangers get nothing', async () => {
  const s = st(as('stranger'));
  await assertFails(getBytes(ref(s, 'receipts/u-contrib/auto_1_receipt.png')));
  await assertFails(uploadBytes(ref(s, 'receipts/u-strange/a.png'), png, { contentType: 'image/png' }));
});
test('storage: HTML/JS uploads are rejected', async () => {
  const s = st(as('contributor'));
  await assertFails(uploadBytes(ref(s, 'receipts/u-contrib/x.html'), png, { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(s, 'receipts/u-contrib/x.js'), png, { contentType: 'application/javascript' }));
});
