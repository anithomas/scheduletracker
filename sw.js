// Family Household Tracker — Service Worker
// Strategy: network-first (app requires Firebase auth + live data)
// Caches the app shell so it loads even on flaky connections

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyC8ia7A7bExTCevqX-0CDSzJucsT12DDlk",
  authDomain: "home-and-auto-tracker.firebaseapp.com",
  projectId: "home-and-auto-tracker",
  storageBucket: "home-and-auto-tracker.firebasestorage.app",
  messagingSenderId: "642422032748",
  appId: "1:642422032748:web:cc9c6e2c7b9493f2728b49"
};

firebase.initializeApp(FIREBASE_CONFIG);
const messagingInstance = firebase.messaging();

// Handle background push notifications (app closed or backgrounded)
messagingInstance.onBackgroundMessage(function(payload) {
  const notif = payload.notification || {};
  self.registration.showNotification(notif.title || 'Reminder', {
    body: notif.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data || {}
  });
});

// Bump this on every deploy that changes cached behavior. Changing this value
// changes the SW script's bytes, which is what makes browsers notice there's
// a new worker to install — an unchanged sw.js can otherwise sit unnoticed
// for up to a day even when index.html has changed.
const CACHE = 'tracker-v3';
const PRECACHE = ['/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
     // Tell every open tab a new version just took over, so the app can
     // prompt for (or silently do) a reload instead of running stale JS
     // indefinitely in a tab that's never manually refreshed.
     .then(() => self.clients.matchAll({ type: 'window' }))
     .then(clientsList => clientsList.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  // Skip non-GET and Firebase/Google API requests (let them go direct)
  const url = new URL(e.request.url);
  if (
    e.request.method !== 'GET' ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis') ||
    url.hostname.includes('gstatic') ||
    url.hostname.includes('firestore') ||
    url.hostname.includes('google')
  ) {
    return;
  }

  // Network-first for everything else — fall back to cache if offline.
  // Critically, the HTML document (navigations, and '/' itself) is fetched
  // with cache:'no-store' so the browser's own HTTP cache can never hand
  // back a stale copy underneath this "network-first" logic — without this,
  // fetch() here would silently honour ordinary HTTP caching (e.g. GitHub
  // Pages' CDN headers) and this handler's cache-fallback code would never
  // even run, because the *first* attempt was already stale.
  const isDocument = e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  const fetchOptions = isDocument ? { cache: 'no-store' } : {};

  e.respondWith(
    fetch(e.request, fetchOptions)
      .then(res => {
        // Cache a fresh copy of the page
        if (res.ok && url.hostname === self.location.hostname) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
