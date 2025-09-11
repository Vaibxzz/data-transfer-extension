// signup.js — Kosh auth (email + Google + Outlook) — drop-in replacement
// Put this at site root (served as /signup.js). Depends on firebase compat or window.__KOSH__ already initialized.

(function () {
  'use strict';

  // CONFIG — update API_BASE_URL if backend location changes
  const API_BASE_URL = "https://kosh-backend-1094058263345.us-central1.run.app";

  // firebase handles (compat or injected wrapper)
  const firebaseAuth = () => (window.__KOSH__ && window.__KOSH__.auth) ? window.__KOSH__.auth : (window.firebase && window.firebase.auth ? window.firebase : null);
  const firebaseFirestore = () => (window.__KOSH__ && window.__KOSH__.firestore) ? window.__KOSH__.firestore : (window.firebase && window.firebase.firestore ? window.firebase.firestore : null);

  // small UI helpers — replace/augment with your UI functions if needed
  function showError(msg) { try { alert(msg); } catch(e){ console.error(msg); } }
  function showSuccess(msg) { try { alert(msg); } catch(e){ console.log(msg); } }
  function isValidEmail(email) { return /\S+@\S+\.\S+/.test(email); }

  // Auth local manager (keeps existing localStorage behavior)
  class AuthManager {
    constructor() {
      this.isAuthenticated = false;
      this.user = null;
    }
    init() {
      try {
        const saved = localStorage.getItem("kosh_auth");
        if (!saved) return;
        const data = JSON.parse(saved);
        if (data && data.expiry && Date.now() < data.expiry) {
          this.isAuthenticated = true;
          this.user = data.user;
          console.log("Restored auth from localStorage", this.user);
        } else {
          localStorage.removeItem("kosh_auth");
        }
      } catch (e) {
        localStorage.removeItem("kosh_auth");
      }
    }
    setAuthenticated(user, method = "email") {
      this.isAuthenticated = true;
      this.user = user;
      const record = {
        user,
        method,
        expiry: Date.now() + 24 * 60 * 60 * 1000,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem("kosh_auth", JSON.stringify(record));
      showSuccess(`Welcome ${user.name || user.email || ''}!`);
      // use absolute path to ensure Cloudflare Pages finds dashboard at site root
      setTimeout(() => { window.location.href = "/dashboard.html"; }, 600);
    }
    logout() {
      localStorage.removeItem("kosh_auth");
      this.isAuthenticated = false;
      this.user = null;
      window.location.reload();
    }
  }
  const authManager = new AuthManager();

  // ====== Backend helpers ======
  async function apiPost(path, body) {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, data };
    } catch (err) {
      console.error('API error', err);
      return { ok: false, data: { message: 'Network error' } };
    }
  }

  async function authenticateUser(email, password) {
    const r = await apiPost('/login', { email, password });
    return r;
  }
  async function registerUser(email, password, name) {
    const r = await apiPost('/register', { email, password, name });
    return r;
  }

  // ====== Email handlers ======
  async function handleEmailLogin(e) {
    e && e.preventDefault();
    const email = (document.getElementById('login-email') || {}).value || '';
    const password = (document.getElementById('login-password') || {}).value || '';
    if (!email || !password) return showError('Please enter both email and password.');
    if (!isValidEmail(email)) return showError('Please enter a valid email.');

    const btn = document.querySelector('.login-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in...'; }
    try {
      const r = await authenticateUser(email, password);
      if (!r.ok) return showError(r.data?.message || 'Invalid credentials');
      // record returned user or fallback
      const user = r.data.user || { email };
      authManager.setAuthenticated(user, 'email');
    } catch (err) {
      console.error(err);
      showError('Login failed. Try again later.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
    }
  }

  async function handleRegister(e) {
    e && e.preventDefault();
    const email = (document.getElementById('signup-email') || {}).value || '';
    const password = (document.getElementById('signup-password') || {}).value || '';
    const confirm = (document.getElementById('signup-password-confirm') || {}).value || '';
    if (!email || !password || !confirm) return showError('Please fill all fields.');
    if (!isValidEmail(email)) return showError('Please enter a valid email.');
    if (password !== confirm) return showError('Passwords do not match.');

    const btn = document.querySelector('.register-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Registering...'; }
    try {
      const name = email.split('@')[0];
      const r = await registerUser(email, password, name);
      if (!r.ok) return showError(r.data?.message || 'Registration failed.');
      const user = r.data.user || { email, name };
      authManager.setAuthenticated(user, 'email');
    } catch (err) {
      console.error(err);
      showError('Registration failed. Try again later.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
    }
  }

  // ====== Google (Firebase) ======
  async function initiateGoogleAuth(e) {
    e && e.preventDefault();
    const btn = document.querySelector('.google-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Authenticating...'; }
    try {
      const fb = firebaseAuth();
      if (!fb) throw new Error('Firebase not initialized');
      const provider = new fb.GoogleAuthProvider ? new fb.GoogleAuthProvider() : new firebase.auth.GoogleAuthProvider();
      const auth = fb;
      const result = await auth.signInWithPopup(provider);
      const user = result.user || (result && result.user) || {};
      // try sending ID token to backend if you have sessionLogin
      try {
        const idToken = await user.getIdToken();
        await fetch(`${API_BASE_URL}/sessionLogin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ idToken })
        }).catch(()=>{});
      } catch(x){ console.warn('send id token failed', x); }
      authManager.setAuthenticated({ email: user.email, name: user.displayName, avatar: user.photoURL }, 'google');
    } catch (err) {
      console.error('Google auth error', err);
      showError('Google sign-in failed: ' + (err && err.message ? err.message : err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Continue with Google'; }
    }
  }

  // ====== Outlook (Azure implicit flow popup) ======
  function resetOutlookButton() {
    const el = document.querySelector('.outlook-btn');
    if (!el) return;
    el.innerHTML = '<img src="https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/microsoftoutlook.svg" alt="outlook" /> Continue with Outlook';
    el.disabled = false;
  }

  function handleOutlookAuth(e) {
    e && e.preventDefault();
    const btn = document.querySelector('.outlook-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening Microsoft…'; }
    // IMPORTANT: set your Azure AD client id here
    const clientId = "663c904c-c20d-4a9b-9529-67f0d144462d";
    const redirectUri = window.location.origin + '/auth'; // Cloudflare serves /auth
    const scopes = encodeURIComponent('openid profile email User.Read');
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_mode=fragment&state=${Date.now()}`;

    const w = 520, h = 620, left = Math.max(0, (screen.width - w) / 2), top = Math.max(0, (screen.height - h) / 2);
    const popup = window.open(authUrl, 'Outlook Login', `width=${w},height=${h},top=${top},left=${left}`);

    const timer = setInterval(async () => {
      try {
        if (!popup || popup.closed) { clearInterval(timer); resetOutlookButton(); return; }
        const hash = popup.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            clearInterval(timer);
            popup.close();
            // fetch user info
            try {
              const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (!profileRes.ok) throw new Error('profile fetch failed');
              const profile = await profileRes.json();
              const user = {
                email: profile.mail || profile.userPrincipalName,
                name: profile.displayName,
                avatar: null
              };
              // attempt to get photo (optional)
              try {
                const photoRes = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (photoRes.ok) {
                  const blob = await photoRes.blob();
                  user.avatar = URL.createObjectURL(blob);
                }
              } catch (_) {}
              authManager.setAuthenticated(user, 'outlook');
              return;
            } catch (err) {
              console.error('Outlook profile error', err);
              showError('Microsoft login failed');
              resetOutlookButton();
            }
          }
        }
      } catch (err) {
        // cross-origin until popup lands on your origin
      }
    }, 400);
  }

  // ====== DOM wiring ======
  function wireUI() {
    authManager.init();

    // email buttons
    const loginBtn = document.querySelector('.login-btn');
    if (loginBtn) loginBtn.addEventListener('click', handleEmailLogin);

    const registerBtn = document.querySelector('.register-btn');
    if (registerBtn) registerBtn.addEventListener('click', handleRegister);

    // social buttons
    document.querySelectorAll('.google-btn').forEach(b => b.addEventListener('click', initiateGoogleAuth));
    document.querySelectorAll('.outlook-btn').forEach(b => b.addEventListener('click', handleOutlookAuth));

    // tabs -- ensure we reliably find sections
    const loginTab = document.getElementById('tab-login');
    const signupTab = document.getElementById('tab-signup');
    const loginSection = document.getElementById('login-section');
    const registerSection = document.getElementById('register-section');

    if (loginTab && signupTab && loginSection && registerSection) {
      loginTab.addEventListener('click', () => {
        loginTab.classList.add('active'); signupTab.classList.remove('active');
        loginSection.style.display = ''; // use CSS default
        registerSection.style.display = 'none';
      });
      signupTab.addEventListener('click', () => {
        signupTab.classList.add('active'); loginTab.classList.remove('active');
        registerSection.style.display = ''; // use CSS default
        loginSection.style.display = 'none';
      });
    }

    console.log('signup.js: wired UI handlers');
  }

  // run after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUI);
  } else {
    wireUI();
  }

})();