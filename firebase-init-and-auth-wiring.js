// pages/firebase-init-and-auth-wiring.js
// Small Firebase init + onAuthStateChanged wiring used by signup.html / auth UI.
//
// Expectations:
// - Your build places a firebase config object at `window.FIREBASE_CONFIG` (or you can
//   inline a small `firebase-config.js` that sets window.FIREBASE_CONFIG).
// - The page also loads the Firebase compat SDKs (app-compat, auth-compat, firestore-compat)
//   before this script or via "defer" after this script. If SDKs load later, this file
//   will wait briefly for them (small retry loop).
//
// This script exposes window.__KOSH__ = { auth, firestore } for your signup.js to consume.

(function () {
    'use strict';
  
    // debug flag (set to false to reduce console noise)
    const DEBUG = true;
  
    function log(...args) { if (DEBUG) console.log('[KOSH-FirebaseInit]', ...args); }
    function warn(...args) { if (DEBUG) console.warn('[KOSH-FirebaseInit]', ...args); }
  
    // Where to read config from. Ensure your build exposes FIREBASE_CONFIG on window.
    const FIREBASE_CONFIG = window.FIREBASE_CONFIG || (window.__KOSH__ && window.__KOSH__.FIREBASE_CONFIG) || null;
  
    // Try to initialize firebase compat if available and not already inited
    function tryInitFirebase() {
      try {
        if (typeof firebase === 'undefined') {
          warn('firebase SDK not loaded yet');
          return false;
        }
  
        // If compat SDK present, check apps array
        if (Array.isArray(firebase.apps) && firebase.apps.length > 0) {
          log('firebase already initialized (apps.length > 0)');
        } else {
          // If we have a config, initialize. If not, skip (hosted config may be provided later)
          if (!FIREBASE_CONFIG || Object.keys(FIREBASE_CONFIG).length === 0) {
            warn('No FIREBASE_CONFIG available to initialize app; skipping init for now');
            return false;
          }
          try {
            firebase.initializeApp(FIREBASE_CONFIG);
            log('firebase.initializeApp called');
          } catch (e) {
            // may throw if already initialized concurrently
            warn('initializeApp error (may be already initialized):', e && e.message ? e.message : e);
          }
        }
  
        // Acquire compat handles if available
        const auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;
        const firestore = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;
  
        // Expose canonical handle object
        window.__KOSH__ = window.__KOSH__ || {};
        window.__KOSH__.auth = auth;
        window.__KOSH__.firestore = firestore;
        window.__KOSH__.FIREBASE_CONFIG = FIREBASE_CONFIG || window.__KOSH__.FIREBASE_CONFIG;
  
        log('exposed window.__KOSH__ handles', {
          auth: !!auth,
          firestore: !!firestore,
          hasConfig: !!window.__KOSH__.FIREBASE_CONFIG
        });
  
        // attach onAuthStateChanged so UI pages can react
        if (auth && typeof auth.onAuthStateChanged === 'function') {
          auth.onAuthStateChanged((user) => {
            if (user) {
              log('onAuthStateChanged: user signed in:', user && user.email);
              // If we're on auth page, redirect to dashboard
              try {
                const path = (location.pathname || '').toLowerCase();
                const onAuthPage = path === '/' || path.endsWith('/auth') || path.endsWith('/auth.html') || path.endsWith('/index.html') || path.endsWith('/login.html');
                if (onAuthPage) {
                  // use replace so back button doesn't loop
                  window.location.replace('/dashboard.html');
                }
              } catch (e) { /* ignore */ }
            } else {
              log('onAuthStateChanged: no firebase user signed in');
            }
          });
        }
  
        return true;
      } catch (e) {
        warn('unexpected init error', e && e.message ? e.message : e);
        return false;
      }
    }
  
    // Retry loop: try a few times (SDKs sometimes load deferred). After that we still expose stub window.__KOSH__.
    (function initWithRetry(attemptsLeft = 12) {
      const ok = tryInitFirebase();
      if (ok) return;
      if (attemptsLeft <= 0) {
        // expose placeholder so signup.js won't throw
        window.__KOSH__ = window.__KOSH__ || {};
        window.__KOSH__.auth = window.__KOSH__.auth || null;
        window.__KOSH__.firestore = window.__KOSH__.firestore || null;
        warn('firebase init not completed after retries; continuing with null handles');
        return;
      }
      setTimeout(() => initWithRetry(attemptsLeft - 1), 200);
    })();
  
  })();