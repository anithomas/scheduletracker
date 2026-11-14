// ─── APP CONFIG CONSTANTS ──────────────────────────────────────
// Moved out of the <head> inline <script> (Phase 3, R4) so the Firebase
// config and friends are ordinary typed module exports instead of
// ambient globals. Values are unchanged from the original index.html.

export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyC8ia7A7bExTCevqX-0CDSzJucsT12DDlk",
  authDomain:        "home-and-auto-tracker.firebaseapp.com",
  projectId:         "home-and-auto-tracker",
  storageBucket:     "home-and-auto-tracker.firebasestorage.app",
  messagingSenderId: "642422032748",
  appId:             "1:642422032748:web:cc9c6e2c7b9493f2728b49"
};

export const HST_RATE = 0.13; // Ontario HST 13%

// FCM Web Push VAPID public key (safe to embed — private key managed by Firebase)
export const VAPID_KEY = 'BA2Id1Ve3MY32gnW5nTeIzNdct_9lMGRvJZOCBu-u4x7djQV1UGfwsjYiTu-gzybRqjIByO8_Kb1rGjkHEvc5x8';

// Google Calendar Sync — Phase 4
// Replace with your OAuth 2.0 Client ID from Google Cloud Console
// (APIs & Services → Credentials → OAuth 2.0 Client IDs → Web application)
export const GCAL_CLIENT_ID = '642422032748-q1ej03fpp20u2p5iqlo88v1tc7sqn3fn.apps.googleusercontent.com';
