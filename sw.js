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

const CACHE = 'tracker-v2';
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
    )
  );
  self.clients.claim();
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

  // Network-first for everything else — fall back to cache if offline
  e.respondWith(
    fetch(e.request)
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
