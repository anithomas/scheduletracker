// ─── INIT ────────────────────────────────────────────────────
// Firebase is loaded via the npm `firebase` package's compat build instead of
// the old gstatic <script> tags (Phase 3, R4), so it's part of the Vite
// bundle. The compat API surface (firebase.auth(), firebase.firestore(), …)
// is unchanged, so every other module keeps calling it exactly as before.
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';
import 'firebase/compat/messaging';

import { FIREBASE_CONFIG } from '../config';

firebase.initializeApp(FIREBASE_CONFIG);
export const auth    = firebase.auth();
export const db      = firebase.firestore();
export const storage = firebase.storage();

// ─── R1: Firestore offline persistence ─────────────────────────
// Lets items get marked done (and everything else) with no signal — e.g. in
// the garage — by caching Firestore data in IndexedDB and queuing writes
// until connectivity returns. `synchronizeTabs: true` because this PWA is
// routinely open in more than one tab/device for the same family member.
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    // Another tab already holds the persistence lock on a browser that
    // doesn't support multi-tab sync — Firestore still works, just without
    // the offline cache in *this* tab.
    console.warn('Offline persistence unavailable in this tab (another tab has the lock).');
  } else if (err.code === 'unimplemented') {
    // Browser doesn't support the required IndexedDB APIs (e.g. some private
    // browsing modes). Firestore falls back to online-only behavior.
    console.warn('Offline persistence not supported in this browser.');
  } else {
    console.warn('Offline persistence failed to enable:', err);
  }
});

// Re-export `firebase` itself: a few modules reach for
// `firebase.firestore.FieldValue.serverTimestamp()` /
// `firebase.firestore.FieldValue.arrayUnion()` etc., which hang off the
// compat namespace rather than off the `db` instance.
export { firebase };
