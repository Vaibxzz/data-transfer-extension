// ====== CONFIG ======
const API_BASE_URL = "https://kosh-backend-1094058263345.us-central1.run.app";

// Firebase handles (injected by index.html)
const auth = window.__KOSH__?.auth || firebase.auth();
const db = window.__KOSH__?.firestore || firebase.firestore();

// ====== AUTH MANAGER ======
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
        showAuthenticatedState(this.user);
      } else {
        localStorage.removeItem("kosh_auth");
      }
    } catch {
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
    showSuccess(`Welcome ${user.name || user.email}! Authentication successful.`);
    setTimeout(() => this.redirectToDashboard(), 800);
  }
  redirectToDashboard() {
    // if you keep a separate dashboard page, update path:
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

// ====== UTILITIES ======
function isValidEmail(email) { return /\S+@\S+\.\S+/.test(email); }
function showError(msg) { alert(msg); }
function showSuccess(msg) { alert(msg); }
function showAuthenticatedState(user) { console.log("Authenticated as", user); }

// ====== API HELPERS ======
async function authenticateUser(email, password) {
  try {
    const res = await fetch(`${API_BASE_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return { success: false, message: "Invalid credentials" };
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
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { success: false, message: data.message || "Registration failed" };
    return { success: true, user: data.user || { email, name } };
  } catch (err) {
    console.error("Register API error:", err);
    return { success: false, message: "Server error. Please try again later." };
  }
}

// If you want your backend to create a session for Google sign-in, send ID token
async function sendFirebaseIdTokenToBackend(idToken) {
  try {
    const res = await fetch(`${API_BASE_URL}/sessionLogin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // if backend sets cookies
      body: JSON.stringify({ idToken }),
    });
    return res.ok;
  } catch (e) {
    console.warn("sessionLogin failed", e);
    return false;
  }
}

// ====== EMAIL LOGIN ======
async function handleEmailLogin() {
  const email = document.getElementById("login-email")?.value?.trim();
  const password = document.getElementById("login-password")?.value || "";

  if (!email || !password) return showError("Please enter both email and password");
  if (!isValidEmail(email)) return showError("Please enter a valid email address");

  const btn = document.querySelector(".login-btn");
  btn.textContent = "Signing in...";
  btn.disabled = true;

  try {
    const resp = await authenticateUser(email, password);
    if (resp.success) {
      authManager.setAuthenticated(
        { email, name: resp.user?.name || email.split("@")[0], avatar: resp.user?.avatar || null },
        "email"
      );
    } else {
      showError(resp.message || "Invalid credentials");
    }
  } catch (e) {
    console.error("Login error", e);
    showError("Login failed. Please try again.");
  } finally {
    btn.textContent = "Login";
    btn.disabled = false;
  }
}

// ====== REGISTER ======
async function handleRegister() {
  const email = document.getElementById("signup-email")?.value?.trim();
  const password = document.getElementById("signup-password")?.value || "";
  const confirm = document.getElementById("signup-password-confirm")?.value || "";
  const name = email ? email.split("@")[0] : "";

  if (!email || !password || !confirm) return showError("Please fill all fields");
  if (!isValidEmail(email)) return showError("Please enter a valid email address");
  if (password !== confirm) return showError("Passwords do not match");

  const btn = document.querySelector(".register-btn");
  btn.textContent = "Registering...";
  btn.disabled = true;

  try {
    const resp = await registerUser(email, password, name);
    if (resp.success) {
      authManager.setAuthenticated(
        { email, name: resp.user?.name || name, avatar: resp.user?.avatar || null },
        "email"
      );
    } else {
      showError(resp.message || "Registration failed");
    }
  } catch (e) {
    console.error("Register error", e);
    showError("Server error. Please try again later.");
  } finally {
    btn.textContent = "Create Account";
    btn.disabled = false;
  }
}

// ====== GOOGLE AUTH (client-side) ======
async function initiateGoogleAuth() {
  const btn = document.querySelector(".google-btn");
  btn.textContent = "Authenticating...";
  btn.disabled = true;

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    const user = result.user;

    // OPTIONAL: send ID token to backend for session creation if you have such endpoint
    const idToken = await user.getIdToken();
    await sendFirebaseIdTokenToBackend(idToken); // safe to ignore result if not used

    authManager.setAuthenticated(
      { email: user.email, name: user.displayName, avatar: user.photoURL },
      "google"
    );
    showSuccess("Signed in with Google!");
  } catch (e) {
    console.error("Google login error:", e);
    showError("Google authentication failed: " + (e?.message || "Unknown error"));
  } finally {
    btn.textContent = "Continue with Google";
    btn.disabled = false;
  }
}

// ====== OUTLOOK AUTH (implicit flow) ======
async function handleOutlookAuth() {
  const outlookBtn = document.querySelector(".outlook-btn");
  outlookBtn.textContent = "Opening Microsoft…";
  outlookBtn.disabled = true;

  const clientId = "663c904c-c20d-4a9b-9529-67f0d144462d"; // your Azure app clientId
  // allow both index.html and auth.html as redirect targets
  const redirectPath = (window.location.pathname.endsWith("auth.html")) ? "/auth.html" : "/index.html";
  const redirectUri = window.location.origin + redirectPath;
  const scopes = encodeURIComponent("openid profile email User.Read");

  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` +
    `?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}&response_mode=fragment&state=${Date.now()}`;

  const w = 520, h = 620;
  const left = Math.max(0, (screen.width - w) / 2);
  const top = Math.max(0, (screen.height - h) / 2);
  const popup = window.open(authUrl, "Outlook Login", `width=${w},height=${h},top=${top},left=${left}`);

  const timer = setInterval(() => {
    try {
      if (!popup || popup.closed) { clearInterval(timer); resetOutlookButton(); return; }
      const hash = popup.location.hash;
      if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        const token = params.get("access_token");
        if (token) {
          clearInterval(timer);
          popup.close();
          fetchOutlookUserInfo(token);
        }
      }
    } catch {
      // wait until popup lands on our origin
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
    } catch {}

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

// ====== EVENTS ======
document.addEventListener("DOMContentLoaded", () => {
  authManager.init();

  const loginBtn = document.querySelector(".login-btn");
  if (loginBtn) loginBtn.addEventListener("click", handleEmailLogin);

  const registerBtn = document.querySelector(".register-btn");
  if (registerBtn) registerBtn.addEventListener("click", handleRegister);

  document.querySelectorAll(".google-btn").forEach(btn => {
    btn.addEventListener("click", initiateGoogleAuth);
  });
  document.querySelectorAll(".outlook-btn").forEach(btn => {
    btn.addEventListener("click", handleOutlookAuth);
  });

  // Tabs toggle
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
  }
});