/* firebase-init-and-auth-wiring.js
   Loads after firebase-app-compat and firebase-auth-compat scripts (deferred).
   Exposes window.__KOSH__ = { app, auth, firestore } when ready.
*/
(function () {
  'use strict';

  function safeLog() { try { console.log.apply(console, arguments); } catch (e) {} }

  if (!window.FIREBASE_CONFIG) {
    safeLog('firebase-init: FIREBASE_CONFIG missing');
    return;
  }

  try {
    // initialize only if not already
    if (!Array.isArray(window.firebase?.apps) || window.firebase.apps.length === 0) {
      window.firebase.initializeApp(window.FIREBASE_CONFIG);
    }
    const auth = window.firebase.auth ? window.firebase.auth() : null;
    const firestore = window.firebase.firestore ? window.firebase.firestore() : null;
    window.__KOSH__ = { app: window.firebase.app(), auth, firestore };
    safeLog('Firebase init + auth wiring ready.');

    // on auth state change: redirect to dashboard when signed in (and on auth page)
    if (auth && typeof auth.onAuthStateChanged === 'function') {
      auth.onAuthStateChanged(user => {
        if (user) {
          safeLog('firebase auth user', user);
          // When a user signs-in client-side, ensure we go to the dashboard
          // If we are already on some auth page, redirect; otherwise do nothing.
          try {
            const path = (location.pathname || '').toLowerCase();
            if (path === '/' || path.endsWith('/auth.html') || path.endsWith('/auth')) {
              window.location.replace('/dashboard.html');
            }
          } catch (e) { /* ignore */ }
        } else {
          safeLog('no firebase user signed in');
        }
      });
    }
  } catch (e) {
    console.error('firebase-init wiring failed', e);
  }
})();
