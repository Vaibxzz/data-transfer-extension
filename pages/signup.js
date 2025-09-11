// signup.js — robust auth wiring for Kosh
// Paste this file over your existing signup.js and deploy to Pages.

(() => {
  'use strict';

  // ====== CONFIG ======
  const API_BASE_URL = "https://kosh-backend-1094058263345.us-central1.run.app";

  // Safe firebase handles: try injected window.__KOSH__ first, then compat fallback,
  // but always guard so code doesn't throw if firebase isn't ready.
  function getFirebaseHandles() {
    try {
      if (window.__KOSH__) {
        return { auth: window.__KOSH__.auth, firestore: window.__KOSH__.firestore };
      }
      if (typeof firebase !== 'undefined' && typeof firebase.auth === 'function') {
        return { auth: firebase.auth(), firestore: (typeof firebase.firestore === 'function' ? firebase.firestore() : null) };
      }
    } catch (e) {
      console.warn('firebase handles unavailable (catch):', e);
    }
    return { auth: null, firestore: null };
  }

  let { auth, firestore } = getFirebaseHandles();

  // allow re-check if wiring finishes later
  function refreshFirebaseHandles() {
    const h = getFirebaseHandles();
    auth = auth || h.auth;
    firestore = firestore || h.firestore;
  }

  // ====== UTILITIES ======
  function isValidEmail(email) { return /\S+@\S+\.\S+/.test(email); }
  function showError(msg) { console.error('UI error:', msg); alert(msg); }
  function showSuccess(msg) { console.log('UI success:', msg); alert(msg); }

  // ====== AUTH MANAGER (local-only session) ======
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
        if (this.isValid(data)) {
          this.isAuthenticated = true;
          this.user = data.user;
          this.applyAuthenticatedState(this.user);
        } else {
          localStorage.removeItem("kosh_auth");
        }
      } catch (err) {
        localStorage.removeItem("kosh_auth");
      }
    }
    isValid(data) {
      return data && data.expiry && Date.now() < data.expiry;
    }
    setAuthenticated(user, method = "email") {
      this.isAuthenticated = true;
      this.user = user;
      const record = {
        user,
        method,
        expiry: Date.now() + 24 * 60 * 60 * 1000,
        timestamp: new Date().toISOString(),
      };
      localStorage.setItem("kosh_auth", JSON.stringify(record));
      this.applyAuthenticatedState(user);
      showSuccess(`Welcome ${user.name || user.email || ''}!`);
      setTimeout(() => this.redirectToDashboard(), 700);
    }
    applyAuthenticatedState(user) {
      console.log('Authenticated user set locally:', user);
      // update UI if needed (placeholder)
    }
    redirectToDashboard() {
      window.location.href = "dashboard.html";
    }
    logout() {
      localStorage.removeItem("kosh_auth");
      this.isAuthenticated = false;
      this.user = null;
      window.location.reload();
    }
  }
  const authManager = new AuthManager();

  // ====== API HELPERS ======
  async function authenticateUser(email, password) {
    try {
      const res = await fetch(`${API_BASE_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json().catch(()=>({message:'invalid'}));
        return { success: false, message: err.message || 'Invalid credentials' };
      }
      const data = await res.json();
      return { success: true, user: data.user || { email } };
    } catch (err) {
      console.error("Auth API error:", err);
      return { success: false, message: "Server error. Try again later." };
    }
  }

  async function registerUser(email, password, name) {
    try {
      const res = await fetch(`${API_BASE_URL}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) return { success: false, message: data.message || "Registration failed" };
      return { success: true, user: data.user || { email, name } };
    } catch (err) {
      console.error("Register API error:", err);
      return { success: false, message: "Server error. Please try again later." };
    }
  }

  // optional: send firebase id token to backend to create session cookie
  async function sendFirebaseIdTokenToBackend(idToken) {
    try {
      const res = await fetch(`${API_BASE_URL}/sessionLogin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ idToken }),
      });
      return res.ok;
    } catch (e) {
      console.warn("sessionLogin failed", e);
      return false;
    }
  }

  // ====== EMAIL LOGIN ======
  async function handleEmailLogin(e) {
    if (e && e.preventDefault) e.preventDefault();
    const emailEl = document.getElementById("login-email");
    const passwordEl = document.getElementById("login-password");
    const email = emailEl?.value?.trim();
    const password = passwordEl?.value || "";

    if (!email || !password) return showError("Please enter both email and password");
    if (!isValidEmail(email)) return showError("Please enter a valid email address");

    const btn = document.querySelector(".login-btn");
    if (btn) { btn.textContent = "Signing in..."; btn.disabled = true; }

    try {
      const resp = await authenticateUser(email, password);
      if (resp.success) {
        authManager.setAuthenticated({ email, name: resp.user?.name || email.split("@")[0], avatar: resp.user?.avatar || null }, "email");
      } else {
        showError(resp.message || "Invalid credentials");
      }
    } catch (err) {
      console.error("Login error", err);
      showError("Login failed. Please try again.");
    } finally {
      if (btn) { btn.textContent = "Login"; btn.disabled = false; }
    }
  }

  // ====== REGISTER ======
  async function handleRegister(e) {
    if (e && e.preventDefault) e.preventDefault();
    const email = document.getElementById("signup-email")?.value?.trim();
    const password = document.getElementById("signup-password")?.value || "";
    const confirm = document.getElementById("signup-password-confirm")?.value || "";
    const name = email ? email.split("@")[0] : "";

    if (!email || !password || !confirm) return showError("Please fill all fields");
    if (!isValidEmail(email)) return showError("Please enter a valid email address");
    if (password !== confirm) return showError("Passwords do not match");

    const btn = document.querySelector(".register-btn");
    if (btn) { btn.textContent = "Registering..."; btn.disabled = true; }

    try {
      const resp = await registerUser(email, password, name);
      if (resp.success) {
        authManager.setAuthenticated({ email, name: resp.user?.name || name, avatar: resp.user?.avatar || null }, "email");
      } else {
        showError(resp.message || "Registration failed");
      }
    } catch (err) {
      console.error("Register error", err);
      showError("Server error. Please try again later.");
    } finally {
      if (btn) { btn.textContent = "Create Account"; btn.disabled = false; }
    }
  }

  // ====== GOOGLE AUTH (using Firebase) ======
  async function initiateGoogleAuth(e) {
    if (e && e.preventDefault) e.preventDefault();
    refreshFirebaseHandles();
    const btn = document.querySelector(".google-btn");
    if (btn) { btn.textContent = "Authenticating..."; btn.disabled = true; }

    if (!auth || typeof auth.signInWithPopup !== 'function') {
      showError("Google sign-in not available (Firebase not initialized).");
      if (btn) { btn.textContent = "Continue with Google"; btn.disabled = false; }
      return;
    }

    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      if (user) {
        const idToken = await user.getIdToken().catch(()=>null);
        if (idToken) await sendFirebaseIdTokenToBackend(idToken).catch(()=>false);
        authManager.setAuthenticated({ email: user.email, name: user.displayName, avatar: user.photoURL }, "google");
        showSuccess("Signed in with Google!");
      } else {
        showError("Google sign-in returned no user.");
      }
    } catch (e) {
      console.error("Google login error:", e);
      showError("Google authentication failed: " + (e?.message || "Unknown error"));
    } finally {
      if (btn) { btn.textContent = "Continue with Google"; btn.disabled = false; }
    }
  }

  // ====== OUTLOOK (Microsoft) AUTH — popup implicit flow then Graph fetch
  async function handleOutlookAuth(e) {
    if (e && e.preventDefault) e.preventDefault();
    const outlookBtn = document.querySelector(".outlook-btn");
    if (outlookBtn) { outlookBtn.textContent = "Opening Microsoft…"; outlookBtn.disabled = true; }

    // your Azure clientId (ensure this is the one registered in Azure & Firebase)
    const clientId = "663c904c-c20d-4a9b-9529-67f0d144462d";

    // redirect to current origin path that Azure accepts
    const redirectPath = (window.location.pathname.endsWith("auth") || window.location.pathname.endsWith("auth.html")) ? "/auth" : "/";
    const redirectUri = window.location.origin + redirectPath;
    const scopes = encodeURIComponent("openid profile email User.Read");

    const authUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scopes}&response_mode=fragment&state=${Date.now()}`;

    const w = 520, h = 620;
    const left = Math.max(0, (screen.width - w) / 2);
    const top = Math.max(0, (screen.height - h) / 2);
    const popup = window.open(authUrl, "Outlook Login", `width=${w},height=${h},top=${top},left=${left}`);

    if (!popup) {
      showError("Popup blocked. Allow popups for this site to sign in with Microsoft.");
      resetOutlookButton();
      return;
    }

    const timer = setInterval(async () => {
      try {
        if (!popup || popup.closed) { clearInterval(timer); resetOutlookButton(); return; }
        const hash = popup.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get("access_token");
          if (token) {
            clearInterval(timer);
            popup.close();
            await fetchOutlookUserInfo(token);
          }
        }
      } catch (err) {
        // cross-origin until popup lands on same origin — ignore until then
      }
    }, 500);
  }

  function resetOutlookButton() {
    const outlookBtn = document.querySelector(".outlook-btn");
    if (!outlookBtn) return;
    outlookBtn.innerHTML = `<img src="https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/microsoftoutlook.svg" alt="outlook" /> Continue with Outlook`;
    outlookBtn.disabled = false;
  }

  async function fetchOutlookUserInfo(token) {
    try {
      const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!profileRes.ok) throw new Error("profile fetch failed");

      const profile = await profileRes.json();

      let avatar = null;
      try {
        const photoRes = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (photoRes.ok) {
          const blob = await photoRes.blob();
          avatar = URL.createObjectURL(blob);
        }
      } catch (ex) { /* ignore photo errors */ }

      const user = {
        email: profile.mail || profile.userPrincipalName,
        name: profile.displayName,
        avatar,
      };
      authManager.setAuthenticated(user, "outlook");
      showSuccess("Signed in with Outlook!");
    } catch (e) {
      console.error("Outlook auth error:", e);
      showError("Failed to authenticate with Microsoft");
      resetOutlookButton();
    }
  }

  // ====== UI wiring (tabs, toggles, event listeners) ======
  function wireUI() {
    // login / signup tab toggle
    const loginTab = document.getElementById("tab-login");
    const signupTab = document.getElementById("tab-signup");
    const loginSection = document.getElementById("login-section");
    const registerSection = document.getElementById("register-section");

    if (loginTab && signupTab && loginSection && registerSection) {
      loginTab.addEventListener("click", () => {
        loginTab.classList.add("active");
        signupTab.classList.remove("active");
        loginSection.style.display = "flex";
        registerSection.style.display = "none";
      });
      signupTab.addEventListener("click", () => {
        signupTab.classList.add("active");
        loginTab.classList.remove("active");
        registerSection.style.display = "flex";
        loginSection.style.display = "none";
      });
    } else {
      console.debug('Tab elements not found; skipping tab wiring');
    }

    // password toggles (show/hide)
    document.querySelectorAll('.password-toggle, .password-toggle-signup, .password-toggle-signup-confirm').forEach(btn=>{
      btn.addEventListener('click', function(e){
        e.preventDefault();
        const container = btn.closest('.input-wrap');
        if (!container) return;
        const input = container.querySelector('input[type="password"], input[type="text"]');
        if (!input) return;
        const isPwd = input.type === 'password';
        input.type = isPwd ? 'text' : 'password';
      });
    });

    // email login/register buttons
    const loginBtn = document.querySelector(".login-btn");
    if (loginBtn) loginBtn.addEventListener("click", handleEmailLogin);
    const registerBtn = document.querySelector(".register-btn");
    if (registerBtn) registerBtn.addEventListener("click", handleRegister);

    // social buttons
    document.querySelectorAll(".google-btn").forEach(btn => btn.addEventListener("click", initiateGoogleAuth));
    document.querySelectorAll(".outlook-btn").forEach(btn => btn.addEventListener("click", handleOutlookAuth));

    console.log('signup.js: UI wired (buttons, tabs).');
  }

  // run wiring after DOM ready; also attempt to refresh firebase handles regularly for a short period
  document.addEventListener('DOMContentLoaded', () => {
    authManager.init();
    wireUI();

    // Attempt to refresh firebase handles for 6 seconds (so deferred init scripts can finish)
    const deadline = Date.now() + 6000;
    const interval = setInterval(() => {
      refreshFirebaseHandles();
      if (auth || Date.now() > deadline) clearInterval(interval);
    }, 200);
  });

  // Helpful debug export (open console and inspect)
  window.__KOSH_SIGNUP_DEBUG = {
    getAuth: () => auth,
    getFirestore: () => firestore,
    authManager,
    rewireUI: wireUI
  };

})();