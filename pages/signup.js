/* signup.js — robust auth wiring for Kosh */
(function(){
  'use strict';
  const API_BASE_URL = "https://kosh-backend-109405826345.us-central1.run.app".replace('109405826345','1094058263345'); // keep your backend URL
  // NOTE: Replace above if needed; or allow existing value.

  // safe firebase handle getter
  function getFirebaseHandles(){
    try {
      if (window.__KOSH__) return { auth: window.__KOSH__.auth, firestore: window.__KOSH__.firestore };
      if (typeof firebase !== 'undefined' && Array.isArray(firebase.apps) && firebase.apps.length > 0) {
        return {
          auth: typeof firebase.auth === 'function' ? firebase.auth() : null,
          firestore: typeof firebase.firestore === 'function' ? firebase.firestore() : null
        };
      }
    } catch(e){ console.debug('firebase handles unavailable', e && e.message); }
    return { auth: null, firestore: null };
  }

  let { auth, firestore } = getFirebaseHandles();
  function refreshFirebaseHandles(){ const h=getFirebaseHandles(); auth = auth || h.auth; firestore = firestore || h.firestore; }

  function isValidEmail(e){return /\S+@\S+\.\S+/.test(e);}
  function showError(msg){ console.error('UI error:', msg); alert(msg); }
  function setLocalSession(user, method='local'){ localStorage.setItem('kosh_auth', JSON.stringify({user,method,ts:Date.now(),expiry:Date.now()+24*3600*1000})); console.log('Authenticated user set locally:', user); }

  async function handleAuthSuccess(resp, method='email'){
    try {
      refreshFirebaseHandles();
      if (resp && resp.token && auth && typeof auth.signInWithCustomToken === 'function') {
        console.log('Signing into Firebase with custom token...');
        await auth.signInWithCustomToken(resp.token);
        console.log('Signed into Firebase with custom token');
        setLocalSession(resp.user, method);
        // onAuthStateChanged in firebase-init will redirect to dashboard; if not, do fallback:
        setTimeout(()=>{ if (!location.pathname.endsWith('/dashboard.html')) location.replace('/dashboard.html'); }, 800);
        return;
      }
      if (resp && resp.user) {
        setLocalSession(resp.user, method);
        location.replace('/dashboard.html');
      }
    } catch (e) {
      console.error('handleAuthSuccess error', e);
      if (resp && resp.user) { setLocalSession(resp.user, method); location.replace('/dashboard.html'); }
      else showError('Authentication succeeded but final sign-in failed.');
    }
  }

  async function postJSON(path, body){
    const res = await fetch(path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(()=>({success:false, message:'invalid-json'}));
    return Object.assign({ ok: res.ok }, json);
  }

  // login handler
  async function handleLogin(ev){
    ev && ev.preventDefault();
    const email = (document.getElementById('login-email')||{}).value?.trim();
    const password = (document.getElementById('login-password')||{}).value || '';
    if (!isValidEmail(email)) return showError('Enter a valid email');
    if (!password || password.length < 6) return showError('Enter a password (>=6 chars)');
    try {
      const r = await postJSON(`${API_BASE_URL}/login`, { email, password });
      if (!r.success) return showError(r.message || 'Login failed');
      await handleAuthSuccess(r, 'email');
    } catch (e) {
      console.error('login error', e);
      showError('Server error — try again later.');
    }
  }

  // register handler
  async function handleRegister(ev){
    ev && ev.preventDefault();
    const email = (document.getElementById('signup-email')||{}).value?.trim();
    const password = (document.getElementById('signup-password')||{}).value || '';
    const confirm = (document.getElementById('signup-password-confirm')||{}).value || '';
    const name = email ? email.split('@')[0] : '';
    if (!isValidEmail(email)) return showError('Enter a valid email');
    if (password.length < 6) return showError('Enter a password (>=6 chars)');
    if (password !== confirm) return showError('Passwords do not match');
    try {
      const r = await postJSON(`${API_BASE_URL}/register`, { email, password, name });
      if (!r.success) return showError(r.message || 'Registration failed');
      await handleAuthSuccess(r, 'email');
    } catch (e) {
      console.error('register error', e);
      showError('Server error — try again later.');
    }
  }

  // Google popup sign-in
  async function initiateGoogleAuth(ev){
    ev && ev.preventDefault();
    refreshFirebaseHandles();
    if (!auth || typeof auth.signInWithPopup !== 'function') return showError('Google sign-in not available (Firebase not initialized).');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      const user = result.user;
      if (user) {
        const idToken = await user.getIdToken().catch(()=>null);
        // optionally send idToken to backend (session cookie)
        setLocalSession({ email: user.email, name: user.displayName, avatar: user.photoURL }, 'google');
        // redirect will be handled by firebase onAuthStateChanged above; fallback:
        setTimeout(()=> location.replace('/dashboard.html'), 400);
      }
    } catch (e) {
      console.error('Google login error', e);
      showError('Google authentication failed: '+(e?.message||'Unknown'));
    }
  }

  // Microsoft Outlook (MSAL-like implicit) — open popup and poll for fragment
  function initiateOutlookAuth(ev){
    ev && ev.preventDefault();
    const clientId = "<YOUR_AZURE_CLIENT_ID>"; // replace or set in firebase console OAuth if using server side
    const redirectUri = window.location.origin + '/auth.html'; // must match Azure app redirect
    const scopes = encodeURIComponent('openid profile email User.Read');
    const authUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' +
      `?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${scopes}&response_mode=fragment&state=${Date.now()}`;

    const w = 520, h = 620;
    const left = Math.max(0, (screen.width - w)/2);
    const top = Math.max(0, (screen.height - h)/2);
    const popup = window.open(authUrl, 'MSLogin', `width=${w},height=${h},top=${top},left=${left}`);
    if (!popup) return showError('Popup blocked. Allow popups for this site.');

    const timer = setInterval(async ()=>{
      try {
        if (!popup || popup.closed) { clearInterval(timer); return; }
        const hash = popup.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            clearInterval(timer);
            popup.close();
            // fetch profile
            try {
              const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` }});
              if (!profileRes.ok) throw new Error('profile fetch failed');
              const profile = await profileRes.json();
              const user = { email: profile.mail || profile.userPrincipalName, name: profile.displayName };
              setLocalSession(user, 'outlook');
              location.replace('/dashboard.html');
            } catch (ex) {
              console.error('Outlook profile error', ex);
              showError('Microsoft sign-in failed');
            }
          }
        }
      } catch (err) {
        // cross origin until popup hits same origin; ignore
      }
    }, 500);
  }

  // UI wiring helpers
  function wireTabs(){
    const tLogin = document.getElementById('tab-login');
    const tSign  = document.getElementById('tab-signup');
    const sLogin = document.getElementById('login-section');
    const sReg   = document.getElementById('register-section');
    if (!tLogin || !tSign || !sLogin || !sReg) return;
    tLogin.addEventListener('click', ()=>{ tLogin.classList.add('active'); tSign.classList.remove('active'); sLogin.style.display=''; sReg.style.display='none'; });
    tSign.addEventListener('click', ()=>{ tSign.classList.add('active'); tLogin.classList.remove('active'); sReg.style.display=''; sLogin.style.display='none'; });
  }
  function wirePasswordToggles(){
    document.querySelectorAll('.password-toggle, .password-toggle-signup, .password-toggle-signup-confirm').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const input = btn.parentElement.querySelector('input[type="password"], input[type="text"]');
        if (!input) return;
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
  }

  function wireButtons(){
    const loginBtn = document.querySelector('.login-btn');
    if (loginBtn) loginBtn.addEventListener('click', handleLogin);
    const regBtn = document.querySelector('.register-btn');
    if (regBtn) regBtn.addEventListener('click', handleRegister);
    document.querySelectorAll('.google-btn').forEach(b=>b.addEventListener('click', initiateGoogleAuth));
    document.querySelectorAll('.outlook-btn').forEach(b=>b.addEventListener('click', initiateOutlookAuth));
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    wireTabs();
    wirePasswordToggles();
    wireButtons();
    // refresh firebase handles for a short period in case init runs after this file
    const deadline = Date.now() + 6000;
    const iv = setInterval(()=>{ refreshFirebaseHandles(); if (auth || Date.now()>deadline) clearInterval(iv); }, 200);
    console.log('signup.js: UI wired (buttons, tabs).');
  });

})();
