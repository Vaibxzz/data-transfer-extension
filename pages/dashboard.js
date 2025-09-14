/* dashboard.js — simple dashboard guard + render */
(function(){
  'use strict';
  document.addEventListener('DOMContentLoaded', ()=>{
    const raw = localStorage.getItem('kosh_auth');
    if (!raw) {
      window.location.replace('/auth.html');
      return;
    }
    try {
      const data = JSON.parse(raw);
      if (!data || !data.user) { window.location.replace('/auth.html'); return; }
      const user = data.user;
      document.querySelector('#welcome-user').textContent = `Welcome, ${user.name || user.email}`;
      document.querySelector('#user-email').textContent = user.email || '';
      document.querySelector('#logout-btn').addEventListener('click', ()=>{
        // clear local session AND sign out firebase if wired
        localStorage.removeItem('kosh_auth');
        try { if (window.__KOSH__?.auth && typeof window.__KOSH__.auth.signOut === 'function') { window.__KOSH__.auth.signOut().catch(()=>{}); } } catch(e){}
        window.location.replace('/auth.html');
      });
    } catch(e) {
      console.error('session parse error', e);
      window.location.replace('/auth.html');
    }
  });
})();
