// pages/signup.js — robust auth wiring for Kosh
(() => {
  'use strict';

  const API_BASE_URL = "https://kosh-backend-1094058263345.us-central1.run.app";

  function getFirebaseHandles() {
    try {
      if (window.__KOSH__) return { auth: window.__KOSH__.auth, firestore: window.__KOSH__.firestore };
      if (typeof firebase !== 'undefined') {
        if (Array.isArray(firebase.apps) && firebase.apps.length > 0) {
          const auth = (typeof firebase.auth === 'function') ? firebase.auth() : null;
          const firestore = (typeof firebase.firestore === 'function') ? firebase.firestore() : null;
          return { auth, firestore };
        } else {
          return { auth: null, firestore: null };
        }
      }
    } catch (e) {
      console.debug('firebase handles unavailable (catch):', e && e.message ? e.message : e);
    }
    return { auth: null, firestore: null };
  }

  let { auth, firestore } = getFirebaseHandles();
  function refreshFirebaseHandles() { const h = getFirebaseHandles(); auth = auth || h.auth; firestore = firestore || h.firestore; }

  function isValidEmail(email) { return /\S+@\S+\.\S+/.test(email); }
  function showError(msg) { console.error('UI error:', msg); alert(msg); }
  function showSuccess(msg) { console.log('UI success:', msg); /* optional small notice */ }

  class AuthManager {
    constructor() { this.isAuthenticated = false; this.user = null; }
    init() {
      try {
        const saved = localStorage.getItem("kosh_auth");
        if (!saved) return;
        const data = JSON.parse(saved);
        if (data && data.expiry && Date.now() < data.expiry) {
          this.isAuthenticated = true;
          this.user = data.user;
          this.applyAuthenticatedState(this.user);
        } else localStorage.removeItem("kosh_auth");
      } catch (e) { localStorage.removeItem("kosh_auth"); }
    }
    setAuthenticated(user, method = "email") {
      this.isAuthenticated = true;
      this.user = user;
      const record = { user, method, expiry: Date.now() + 24*60*60*1000, timestamp: new Date().toISOString() };
      localStorage.setItem("kosh_auth", JSON.stringify(record));
      this.applyAuthenticatedState(user);
      setTimeout(() => this.redirectToDashboard(), 350);
    }
    applyAuthenticatedState(user) { console.log('Authenticated user set locally:', user); }
    redirectToDashboard() {
      const origin = window.location.origin || (window.location.protocol + '//' + window.location.host);
      window.location.replace(origin + '/dashboard.html');
    }
    logout() { localStorage.removeItem("kosh_auth"); this.isAuthenticated = false; this.user = null; window.location.reload(); }
  }
  const authManager = new AuthManager();

  async function sendApiJson(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(()=>({}));
    return { ok: r.ok, status: r.status, data };
  }

  async function handleAuthSuccessWithToken(resp) {
    // resp may contain resp.token (firebase custom token) and resp.user
    try {
      refreshFirebaseHandles();
      if (resp && resp.token && auth && typeof auth.signInWithCustomToken === 'function') {
        await auth.signInWithCustomToken(resp.token);
        // after firebase signIn, optionally get idToken and pass to backend session endpoint
        if (auth.currentUser && typeof auth.currentUser.getIdToken === 'function') {
          try {
            const idToken = await auth.currentUser.getIdToken();
            await fetch(`${API_BASE_URL}/sessionLogin`, { method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include', body: JSON.stringify({ idToken }) }).catch(()=>null);
          } catch (e) { /* ignore */ }
        }
        authManager.setAuthenticated(resp.user || { email: resp.user?.email }, 'firebase-custom');
        return;
      }
    } catch (e) {
      console.error('handleAuthSuccessWithToken error', e);
    }
    // fallback to local only
    if (resp && resp.user) authManager.setAuthenticated(resp.user, 'local-fallback');
  }

  async function handleLoginClick(e) {
    if (e && e.preventDefault) e.preventDefault();
    const email = (document.getElementById('login-email') || {}).value || '';
    const password = (document.getElementById('login-password') || {}).value || '';
    if (!isValidEmail(email)) return showError('Enter a valid email');
    if (!password || password.length < 6) return showError('Enter a password (>=6 chars)');
    const btn = document.querySelector('.login-btn'); if (btn){ btn.textContent='Signing in...'; btn.disabled=true; }
    try {
      const r = await sendApiJson(`${API_BASE_URL}/login`, { email, password });
      if (!r.ok) return showError(r.data && r.data.message ? r.data.message : 'Login failed');
      await handleAuthSuccessWithToken(r.data);
    } catch (err) {
      console.error('login request error', err);
      showError('Server error — try again later.');
    } finally { if (btn){ btn.textContent='Login'; btn.disabled=false; } }
  }

  async function handleRegisterClick(e) {
    if (e && e.preventDefault) e.preventDefault();
    const email = (document.getElementById('signup-email') || {}).value || '';
    const password = (document.getElementById('signup-password') || {}).value || '';
    const passwordConfirm = (document.getElementById('signup-password-confirm') || {}).value || '';
    const name = (document.getElementById('signup-name') || {}).value || undefined;
    if (!isValidEmail(email)) return showError('Enter a valid email');
    if (!password || password.length < 6) return showError('Enter a password (>=6 chars)');
    if (password !== passwordConfirm) return showError('Passwords do not match');
    const btn = document.querySelector('.register-btn'); if (btn){ btn.textContent='Creating...'; btn.disabled=true; }
    try {
      const r = await sendApiJson(`${API_BASE_URL}/register`, { email, password, name });
      if (!r.ok) return showError(r.data && r.data.message ? r.data.message : 'Registration failed');
      await handleAuthSuccessWithToken(r.data);
    } catch (err) {
      console.error('register request error', err);
      showError('Server error — try again later.');
    } finally { if (btn){ btn.textContent='Create Account'; btn.disabled=false; } }
  }

  // optional google using firebase (if firebase present)
  async function initiateGoogleAuth(e) {
    if (e && e.preventDefault) e.preventDefault();
    refreshFirebaseHandles();
    const btn = document.querySelector('.google-btn'); if (btn){ btn.textContent='Authenticating...'; btn.disabled=true; }
    if (!auth || typeof auth.signInWithPopup !== 'function') { showError('Google sign-in not available (Firebase not initialized).'); if (btn){ btn.textContent='Continue with Google'; btn.disabled=false; } return; }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      if (user) {
        const idToken = await user.getIdToken().catch(()=>null);
        if (idToken) await fetch(`${API_BASE_URL}/sessionLogin`, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify({ idToken }) }).catch(()=>null);
        authManager.setAuthenticated({ email: user.email, name: user.displayName, avatar: user.photoURL }, 'google');
      } else showError('Google sign-in returned no user.');
    } catch (e) {
      console.error('Google login error:', e);
      showError('Google authentication failed: ' + (e?.message || 'Unknown'));
    } finally { if (btn){ btn.textContent='Continue with Google'; btn.disabled=false; } }
  }

  // Outlook button — popup implicit flow
  async function handleOutlookAuth(e) {
    if (e && e.preventDefault) e.preventDefault();
    const clientId = '663c904c-c20d-4a9b-9529-67f0d144462d';
    const redirectUri = window.location.origin + '/';
    const scopes = encodeURIComponent('openid profile email User.Read');
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_mode=fragment&state=${Date.now()}`;
    const popup = window.open(authUrl, 'Outlook Login', 'width=520,height=620');
    if (!popup) { showError('Popup blocked.'); return; }
    const timer = setInterval(async () => {
      try {
        if (!popup || popup.closed) { clearInterval(timer); return; }
        const hash = popup.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            clearInterval(timer);
            popup.close();
            // fetch user via Graph
            const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` } });
            const profile = await profileRes.json();
            const user = { email: profile.mail || profile.userPrincipalName, name: profile.displayName };
            authManager.setAuthenticated(user, 'outlook');
          }
        }
      } catch (err) {
        // cross origin while redirecting — ignore
      }
    }, 500);
  }

  // UI wiring
  function wireUI() {
    document.getElementById('tab-login')?.addEventListener('click', () => { document.getElementById('login-section').style.display=''; document.getElementById('register-section').style.display='none'; });
    document.getElementById('tab-signup')?.addEventListener('click', () => { document.getElementById('register-section').style.display=''; document.getElementById('login-section').style.display='none'; });

    document.querySelectorAll('.password-toggle').forEach(btn => btn.addEventListener('click', () => {
      const input = btn.parentElement?.querySelector('input[type="password"], input[type="text"]');
      if (input) input.type = (input.type === 'password' ? 'text' : 'password');
    }));

    document.querySelector('.login-btn')?.addEventListener('click', handleLoginClick);
    document.querySelector('.register-btn')?.addEventListener('click', handleRegisterClick);
    document.querySelectorAll('.google-btn').forEach(b => b.addEventListener('click', initiateGoogleAuth));
    document.querySelectorAll('.outlook-btn').forEach(b => b.addEventListener('click', handleOutlookAuth));

    console.log('signup.js: UI wired (buttons, tabs).');
  }

  // run wiring on DOM ready and also react to firebase-ready
  document.addEventListener('DOMContentLoaded', () => {
    authManager.init();
    wireUI();

    // attempt to refresh firebase handles for a few seconds
    const deadline = Date.now() + 6000;
    const iv = setInterval(() => {
      refreshFirebaseHandles();
      if (auth || Date.now() > deadline) clearInterval(iv);
    }, 250);
  });

  // if your firebase init script dispatches 'kosh:firebase-ready', handle it
  window.addEventListener('kosh:firebase-ready', (ev) => {
    refreshFirebaseHandles();
    console.log('signup.js: received kosh:firebase-ready', ev && ev.detail);
  });

  window.__KOSH_SIGNUP_DEBUG = { getAuth: () => auth, getFirestore: () => firestore, authManager };
})();