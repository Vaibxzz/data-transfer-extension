// pages/firebase-init-and-auth-wiring.js
// External firebase init + expose auth handles (CSP-safe)
// Replace the firebaseConfig object values with your project's values.

(function () {
  'use strict';

  // put your Firebase web config here (or load via build-time injectable file)
  const firebaseConfig = {
    apiKey: "REPLACE_WITH_YOUR_API_KEY",
    authDomain: "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
    projectId: "REPLACE_WITH_YOUR_PROJECT",
    appId: "REPLACE_WITH_YOUR_APP_ID",
    // other fields if needed
  };

  // load compat SDKs if not already loaded (assumes you included <script src=".../firebase-app-compat.js"> etc in HTML)
  try {
    // If using compat SDK via CDN, firebase will be present
    if (typeof firebase === 'undefined' || !Array.isArray(firebase.apps)) {
      console.warn('firebase SDK not detected in page context; ensure scripts for firebase-app-compat & firebase-auth-compat are included in HTML');
    } else {
      // initialize if no app yet
      if (!Array.isArray(firebase.apps) || firebase.apps.length === 0) {
        try {
          firebase.initializeApp(firebaseConfig);
        } catch (e) {
          console.warn('firebase.initializeApp warning:', e && e.message);
        }
      }
    }

    // make safe handles, guard in case firebase not ready
    const auth = (typeof firebase !== 'undefined' && Array.isArray(firebase.apps) && firebase.apps.length > 0 && typeof firebase.auth === 'function')
      ? firebase.auth()
      : null;
    const firestore = (typeof firebase !== 'undefined' && Array.isArray(firebase.apps) && firebase.apps.length > 0 && typeof firebase.firestore === 'function')
      ? firebase.firestore()
      : null;

    // expose to page
    window.__KOSH__ = window.__KOSH__ || {};
    window.__KOSH__.auth = auth;
    window.__KOSH__.firestore = firestore;

    // small status log and onAuthStateChanged wiring
    if (auth && typeof auth.onAuthStateChanged === 'function') {
      auth.onAuthStateChanged(user => {
        if (user) {
          console.log('firebase-init-and-auth-wiring: firebase user signed in', user.email);
        } else {
          console.log('firebase-init-and-auth-wiring: no firebase user signed in');
        }
        // dispatch a custom event so signup.js can react if it wants
        window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { user: user ? { email: user.email, uid: user.uid } : null } }));
      });
    } else {
      // still notify that wiring is ready (no firebase)
      window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { user: null } }));
    }

    console.log('Firebase init + auth wiring ready.');
  } catch (err) {
    console.error('firebase-init error', err);
    window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { user: null } }));
  }
})();