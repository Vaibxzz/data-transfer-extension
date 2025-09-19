// firebase-init-and-auth-wiring.js
// Must be loaded after firebase-app-compat.js and firebase-auth-compat.js (and firestore-compat.js if used).
// Exposes window.__KOSH__ = { app, auth, firestore } and dispatches "kosh:firebase-ready" event.

(function () {
  'use strict';

  const log = (...args) => console.log('[KOSH firebase-init]', ...args);
  const warn = (...args) => console.warn('[KOSH firebase-init]', ...args);
  const err = (...args) => console.error('[KOSH firebase-init]', ...args);

  // Accept either of these names (Cloudflare build writes __FIREBASE_CONFIG__, older code used FIREBASE_CONFIG)
  const cfg = window.__FIREBASE_CONFIG__ || window.FIREBASE_CONFIG || window.FIREBASE_CONFIG;
  if (!cfg || typeof cfg !== 'object') {
    err('No Firebase config found on window.__FIREBASE_CONFIG__ or window.FIREBASE_CONFIG. ' +
        'Make sure firebase-config.js is included and served at /firebase-config.js');
    // Still dispatch ready so other code can gracefully fallback.
    window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { ready: false } }));
    return;
  }

  // Wait for the compat SDK to be available
  function whenFirebaseCompatReady(timeoutMs = 5000) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function check() {
        if (typeof window.firebase !== 'undefined' && typeof window.firebase.initializeApp === 'function') {
          return resolve(true);
        }
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(check, 100);
      })();
    });
  }
  // ----------------- Forgot password (Firebase) -----------------
function wireForgotPassword() {
  const forgotLink = document.querySelector('.forgot') || document.getElementById('forgot-link');
  if (!forgotLink) return;

  forgotLink.addEventListener('click', async (e) => {
    e.preventDefault();
    // Prefer email from login input
    const emailInput = document.getElementById('login-email');
    let email = emailInput?.value?.trim() || '';

    // If no email typed, ask user
    if (!email) {
      const typed = prompt('Enter the email address for your account to receive a password reset link:');
      if (!typed) return;
      email = typed.trim();
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      alert('Please enter a valid email address.');
      return;
    }

    await sendFirebaseResetEmail(email);
  });
}

async function sendFirebaseResetEmail(email) {
  try {
    // Prefer an auth handle exposed by the init script, else fall back to firebase.auth()
    const auth = (window.__KOSH__ && window.__KOSH__.auth) ||
                 (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth() : null);

    if (!auth) {
      alert('Authentication system not ready. Please try again in a moment.');
      return;
    }

    // Optional: where the user will land after completing reset (adjust if needed)
    const actionCodeSettings = {
      url: window.location.origin + '/auth.html',
      handleCodeInApp: false
    };

    // UI cue: disable focused element
    const prev = document.activeElement;
    // send reset email (returns a promise)
    await auth.sendPasswordResetEmail(email, actionCodeSettings);

    alert('Password reset email sent. Check your inbox (and spam).');
    if (document.getElementById('login-email')) document.getElementById('login-email').value = '';
    if (prev && prev.focus) prev.focus();

  } catch (err) {
    console.error('sendResetEmail error', err);
    const code = err && err.code ? err.code : '';
    if (code === 'auth/user-not-found') {
      alert('No account found for that email.');
    } else if (code === 'auth/invalid-email') {
      alert('Invalid email address.');
    } else if (code === 'auth/network-request-failed') {
      alert('Network error. Please check your connection and try again.');
    } else {
      alert('Could not send reset email. Try again later.');
    }
  }
}
// ----------------- end forgot password -----------------
  (async function init() {
    const ok = await whenFirebaseCompatReady(6000);
    if (!ok) {
      warn('Firebase compat SDK not available (timeout). Some features will be disabled.');
      window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { ready: false } }));
      return;
    }

    try {
      // Avoid double initialization (compat uses firebase.apps array)
      let app;
      if (Array.isArray(firebase.apps) && firebase.apps.length > 0) {
        app = firebase.apps[0];
        log('Firebase app already initialized, reusing existing app.');
      } else {
        app = firebase.initializeApp(cfg);
        log('Firebase app initialized using provided config.');
      }

      // auth and firestore handles (compat)
      let auth = null;
      let firestore = null;

      try {
        if (typeof firebase.auth === 'function') {
          auth = firebase.auth();
          // prefer session persistence for web apps: try local first (reduce accidental sign-outs)
          if (auth && auth.setPersistence) {
            try {
              // use local persistence by default; for highly secure apps choose 'session' or custom
              await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
            } catch (pErr) {
              // ignore persistence set failures; continue
              warn('Could not set auth persistence:', pErr && pErr.message ? pErr.message : pErr);
            }
          }
        }
      } catch (e) {
        warn('firebase.auth() not available (compat or modular mismatch):', e && e.message ? e.message : e);
      }

      try {
        if (typeof firebase.firestore === 'function') {
          firestore = firebase.firestore();
        }
      } catch (e) {
        // Firestore may not be used; that's ok
        warn('firebase.firestore() not available:', e && e.message ? e.message : e);
      }

      // Expose a small, stable handle object for other scripts
      window.__KOSH__ = {
        app,
        auth,
        firestore,
        config: cfg
      };

      log('Firebase init + auth wiring ready.', {
        hasAuth: !!auth,
        hasFirestore: !!firestore,
        projectId: cfg.projectId || '(unknown)'
      });

      // Wire onAuthStateChanged (if auth exists) so pages/scripts can react.
      if (auth && typeof auth.onAuthStateChanged === 'function') {
        auth.onAuthStateChanged((user) => {
          if (user) {
            log('firebase-init: user signed in', user && (user.email || user.uid));
          } else {
            log('firebase-init: no firebase user signed in');
          }
          // Let other scripts know auth state changed
          window.dispatchEvent(new CustomEvent('kosh:auth-state-changed', { detail: { user: user || null } }));
        });
      } else {
        // Still dispatch event so listening code doesn't hang waiting.
        window.dispatchEvent(new CustomEvent('kosh:auth-state-changed', { detail: { user: null } }));
      }
      wireForgotPassword();

      // Dispatch final ready event (success)
      window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { ready: true, config: cfg } }));

      // Small helper: expose waitForReady promise
      let _readyResolve;
      window.__KOSH__._ready = new Promise((res) => { _readyResolve = res; });
      _readyResolve({ ready: true, config: cfg });

    } catch (e) {
      err('Error initializing Firebase (unexpected):', e && e.message ? e.message : e);
      window.dispatchEvent(new CustomEvent('kosh:firebase-ready', { detail: { ready: false } }));
    }
  })();

})();