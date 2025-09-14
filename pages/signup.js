/* signup.js — email + Google + Outlook + redirect */
(function(){
  'use strict';
  const API_BASE_URL = "http://localhost:8080"; // <- update if needed

  function getFirebaseHandles(){
    try {
      if (window.__KOSH__ && window.__KOSH__.ready) {
        return { auth: window.__KOSH__.auth, firestore: window.__KOSH__.firestore, config: window.__KOSH__.config };
      }
      if (typeof firebase !== 'undefined' && Array.isArray(firebase.apps) && firebase.apps.length>0) {
        return { auth: typeof firebase.auth === 'function' ? firebase.auth() : null, firestore: typeof firebase.firestore === 'function' ? firebase.firestore() : null };
      }
    } catch(e) { console.debug('getFirebaseHandles err', e && e.message || e); }
    return { auth:null, firestore:null };
  }

  let { auth } = getFirebaseHandles();
  function refreshFirebaseHandles(){ const h = getFirebaseHandles(); auth = auth || h.auth; }

  function el(sel){ return document.querySelector(sel); }
  function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
  function isValidEmail(email){ return /\S+@\S+\.\S+/.test(email); }
  function showError(msg){ console.error(msg); alert(msg); }
  function showSuccess(msg){ console.log(msg); /* optional UI toast */ }

  function setLocalSession(user, method='local'){
    try {
      const rec = { user, method, ts:Date.now(), expiry: Date.now()+86400000 };
      localStorage.setItem('kosh_auth', JSON.stringify(rec));
      console.log('Authenticated user set locally:', user);
    } catch(e){}
  }

  async function handleAuthSuccess(resp, method='email'){
    try {
      refreshFirebaseHandles();
      if (resp && resp.token && auth && typeof auth.signInWithCustomToken === 'function') {
        try {
          await auth.signInWithCustomToken(resp.token);
          setLocalSession(resp.user || { email: resp.user?.email }, method);
          window.location.href = 'dashboard.html';
          return;
        } catch(e){
          console.warn('custom token sign-in failed', e);
        }
      }
      if (resp && resp.user) {
        setLocalSession(resp.user, method);
        window.location.href = 'dashboard.html';
        return;
      }
      showError('Auth succeeded but no user info.');
    } catch(e){
      console.error('handleAuthSuccess error', e);
      if (resp && resp.user){ setLocalSession(resp.user, method); window.location.href='dashboard.html'; }
    }
  }

  async function postJson(url, body){
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    const json = await res.json().catch(()=>({}));
    return { ok: res.ok, status: res.status, body: json };
  }

  // Email login
  async function doLogin(){
    const email = el('#login-email')?.value?.trim() || '';
    const password = el('#login-password')?.value || '';
    if (!isValidEmail(email)) return showError('Enter a valid email');
    if (!password || password.length < 6) return showError('Enter a password >= 6 chars');

    const btn = el('.login-btn');
    if (btn){ btn.textContent='Signing in...'; btn.disabled=true; }
    try {
      const r = await postJson(API_BASE_URL + '/login', { email, password });
      if (!r.ok) return showError(r.body?.message || 'Login failed');
      await handleAuthSuccess(r.body, 'email');
    } catch(e){
      console.error('login err', e); showError('Server error');
    } finally { if (btn){ btn.textContent='Log In'; btn.disabled=false; } }
  }

  // Register
  async function doRegister(){
    const email = el('#signup-email')?.value?.trim() || '';
    const name = el('#signup-name')?.value?.trim() || email.split('@')[0] || '';
    const password = el('#signup-password')?.value || '';
    const confirm = el('#signup-password-confirm')?.value || '';
    if (!isValidEmail(email)) return showError('Enter a valid email');
    if (!password || password.length < 6) return showError('Enter a password >=6 chars');
    if (password !== confirm) return showError('Passwords do not match');

    const btn = el('.register-btn');
    if (btn){ btn.textContent='Registering...'; btn.disabled=true; }
    try {
      const r = await postJson(API_BASE_URL + '/register', { email, password, name });
      if (!r.ok) return showError(r.body?.message || 'Register failed');
      await handleAuthSuccess(r.body, 'email');
    } catch(e){
      console.error('register err', e); showError('Server error');
    } finally { if (btn){ btn.textContent='Sign Up'; btn.disabled=false; } }
  }

  // Google auth
  async function doGoogle(){
    refreshFirebaseHandles();
    const btn = el('.google-btn');
    if (btn){ btn.textContent='Authenticating...'; btn.disabled=true; }
    if (!auth || typeof auth.signInWithPopup !== 'function') {
      showError('Google sign-in not available (Firebase not initialized).');
      if (btn){ btn.textContent='Continue with Google'; btn.disabled=false; }
      return;
    }
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const res = await auth.signInWithPopup(provider);
      const user = res.user;
      if (user) {
        setLocalSession({ email:user.email, name:user.displayName, avatar:user.photoURL }, 'google');
        window.location.href = 'dashboard.html';
      } else showError('Google sign-in returned no user.');
    } catch(e){
      console.error('google err', e); showError('Google auth failed: ' + (e?.message || ''));
    } finally { if (btn){ btn.textContent='Continue with Google'; btn.disabled=false; } }
  }

  // Outlook (simple popup implicit flow)
  function doOutlook(){
    const clientId = "663c904c-c20d-4a9b-9529-67f0d144462d"; // replace or keep if configured
    const redirectUri = window.location.origin + '/'; // ensure allowed in Azure app
    const scope = encodeURIComponent('openid profile email User.Read');
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize' +
                '?client_id=' + encodeURIComponent(clientId) +
                '&response_type=token' +
                '&redirect_uri=' + encodeURIComponent(redirectUri) +
                '&scope=' + scope +
                '&response_mode=fragment' +
                '&state=' + Date.now();

    const w = 520, h = 620, left = Math.max(0, (screen.width - w)/2), top = Math.max(0, (screen.height - h)/2);
    const popup = window.open(url, 'Outlook Login', `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) return showError('Popup blocked. Allow popups to sign-in with Microsoft.');

    const poll = setInterval(()=>{
      try {
        if (!popup || popup.closed) { clearInterval(poll); return; }
        const hash = popup.location.hash;
        if (hash) {
          const params = new URLSearchParams(hash.substring(1));
          const token = params.get('access_token');
          if (token) {
            clearInterval(poll);
            popup.close();
            // fetch profile and set local session
            fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: 'Bearer ' + token } })
              .then(r => r.json())
              .then(profile => {
                const u = { email: profile.mail || profile.userPrincipalName, name: profile.displayName };
                setLocalSession(u, 'outlook');
                window.location.href = 'dashboard.html';
              }).catch(e => {
                console.error('outlook profile err', e);
                showError('Microsoft sign-in failed');
              });
          }
        }
      } catch(e){}
    }, 500);
  }

  // UI wiring
  function wireUI(){
    // tabs toggle via links
    const showSignup = el('#show-signup');
    const showLogin = el('#show-login');
    if (showSignup) showSignup.addEventListener('click', (e)=>{ e.preventDefault(); el('#login-section').style.display='none'; el('#signup-section').style.display='block'; });
    if (showLogin) showLogin.addEventListener('click', (e)=>{ e.preventDefault(); el('#signup-section').style.display='none'; el('#login-section').style.display='block'; });

    $all('.password-toggle, .password-toggle-signup, .password-toggle-signup-confirm').forEach(btn=>{
      btn.addEventListener('click', (ev)=>{
        const container = btn.closest('.password-container');
        if (!container) return;
        const input = container.querySelector('input[type="password"], input[type="text"]');
        if (!input) return;
        input.type = (input.type === 'password') ? 'text' : 'password';
      });
    });

    el('.login-btn')?.addEventListener('click', (e)=>{ e.preventDefault(); doLogin(); });
    el('.register-btn')?.addEventListener('click', (e)=>{ e.preventDefault(); doRegister(); });
    $all('.google-btn').forEach(b => b.addEventListener('click', (e)=>{ e.preventDefault(); doGoogle(); }));
    $all('.outlook-btn').forEach(b => b.addEventListener('click', (e)=>{ e.preventDefault(); doOutlook(); }));
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireUI();
    // attempt to pick up firebase inits
    const deadline = Date.now() + 5000;
    const t = setInterval(()=>{
      refreshFirebaseHandles();
      if (auth || Date.now() > deadline) clearInterval(t);
    }, 200);
  });
})();
