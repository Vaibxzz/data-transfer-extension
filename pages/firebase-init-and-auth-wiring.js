// firebase-init-and-auth-wiring.js
(function () {
  'use strict';

  // Wait for firebase compat SDKs to be available and initialize handles.
  // This file must be loaded AFTER the compat SDK <script> tags (they can be defer'd).
  // When ready it sets window.__KOSH__ = { auth, firestore, firebaseConfig } and
  // dispatches a "kosh:firebase-ready" event on window.

  function readyHandles() {
    try {
      if (typeof firebase === 'undefined') return null;
      if (!firebase.apps || !firebase.apps.length) return null;
      const auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;
      const firestore = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;
      return { auth, firestore, firebaseConfig: firebase.app().options };
    } catch (e) {
      console.warn('kosh:init: error checking firebase handles', e);
      return null;
    }
  }

  function setHandlesAndNotify(handles) {
    window.__KOSH__ = window.__KOSH__ || {};
    window.__KOSH__.auth = handles.auth;
    window.__KOSH__.firestore = handles.firestore;
    window.__KOSH__.firebaseConfig = handles.firebaseConfig || null;
    // dispatch an event others can listen to
    try {
      const ev = new CustomEvent('kosh:firebase-ready', { detail: { timestamp: Date.now() } });
      window.dispatchEvent(ev);
    } catch (e) {
      // Fallback: set a flag (scripts can poll refreshFirebaseHandles)
      window.__KOSH__.ready = true;
    }
    console.log('Firebase init + auth wiring ready.');
  }

  // Poll for at most ~6s (120 * 50ms). Plenty long for deferred SDKs to load.
  const deadline = Date.now() + 6000;
  (function waitLoop() {
    const handles = readyHandles();
    if (handles && (handles.auth || handles.firestore)) {
      setHandlesAndNotify(handles);
      // also wire a helpful onAuthStateChanged redirect helper:
      if (handles.auth && typeof handles.auth.onAuthStateChanged === 'function') {
        handles.auth.onAuthStateChanged(user => {
          if (user) {
            console.log('firebase-init: user signed in:', user && user.email);
            // if we're on an auth page, send user to dashboard
            const path = (location.pathname || '').toLowerCase();
            if (path === '/' || path.endsWith('/auth') || path.endsWith('/auth.html') || path.endsWith('/index.html')) {
              // allow signup.js/AuthManager to handle local storage, but ensure redirect to dashboard
              try { window.location.replace('/dashboard.html'); } catch (e) { /* ignore */ }
            }
          } else {
            console.log('no firebase user signed in');
          }
        });
      }
      return;
    }
    if (Date.now() > deadline) {
      console.warn('kosh:init: firebase SDKs did not become available before deadline.');
      return;
    }
    setTimeout(waitLoop, 50);
  })();

})();