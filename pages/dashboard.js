// paste the entire dashboard.js file you already have, but ensure the following two small things:
// 1) default date-range text matches your screenshot sample (already in HTML above as initial text).
// 2) the avatar default initial is 'V' (HTML shows V). The JS will update it from stored profile when available.
// For convenience, here's the full file content (unchanged behavior from earlier):

(function () {
  'use strict';

  // ---------------- CONFIG ----------------
  window.API_BASE_URL = window.API_BASE_URL || "https://kosh-backend-1094058263345.us-central1.run.app";
  const POLL_MS = 30 * 1000;

  // ---------------- DEFAULT ENTRIES ----------------
  const DEFAULT_ENTRIES = [
    { contact: "Alice Johnson", country: "USA", timestamp: "2025-09-15T10:30:00Z", status: "processed", approved: true },
    { contact: "Bob Smith", country: "UK", timestamp: "2025-09-16T12:00:00Z", status: "processed", approved: true },
    { contact: "Carlos Mendes", country: "Portugal", timestamp: "2025-09-10T09:15:00Z", status: "rejected", rejected: true },
    { contact: "Deepa Rao", country: "India", timestamp: "2025-09-18T18:45:00Z", status: "processed", approved: true },
    { contact: "Elena Petrova", country: "Russia", timestamp: "2025-09-05T08:00:00Z", status: "processed" }
  ];

  // ---------------- UTILITIES ----------------
  function safeQuery(selector) { try { return document.querySelector(selector); } catch(e){ return null; } }
  function safeQueryAll(selector) { try { return Array.from(document.querySelectorAll(selector)); } catch(e){ return []; } }
  function escapeHtml(str) { return String(str || '').replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"); }

  function chromeStorageGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, resolve);
      } else {
        const out = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e){ out[k] = localStorage.getItem(k); } });
        } else if (typeof keys === 'string') {
          try { out[keys] = JSON.parse(localStorage.getItem(keys)); } catch(e){ out[keys] = localStorage.getItem(keys); }
        } else if (typeof keys === 'object' && keys !== null) {
          Object.keys(keys).forEach(k => {
            try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e){ out[k] = localStorage.getItem(k); }
            if (out[k] === null || out[k] === undefined) out[k] = keys[k];
          });
        }
        resolve(out);
      }
    });
  }
  function chromeStorageRemove(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(keys, resolve);
      } else {
        if (Array.isArray(keys)) keys.forEach(k => localStorage.removeItem(k));
        else localStorage.removeItem(keys);
        resolve();
      }
    });
  }

  // timestamp helpers
  function normalizeTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && !isNaN(value)) {
      if (value < 1e11) return new Date(value * 1000);
      return new Date(value);
    }
    if (typeof value === 'string') {
      const t = value.trim();
      if (/^\d+$/.test(t)) {
        if (t.length === 10) return new Date(parseInt(t,10)*1000);
        return new Date(parseInt(t,10));
      }
      const d = new Date(t);
      if (!isNaN(d.getTime())) return d;
      const match = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (match) {
        const day = parseInt(match[1],10), month = parseInt(match[2],10)-1, year = parseInt(match[3],10);
        const y = year < 100 ? year + 2000 : year;
        const dd = new Date(y, month, day);
        return isNaN(dd.getTime()) ? null : dd;
      }
    }
    return null;
  }
  function formatDateLocal(d) {
    if (!d) return 'Invalid Date';
    try {
      return d.toLocaleString('en-GB', {
        day:'2-digit', month:'short', year:'numeric',
        hour:'2-digit', minute:'2-digit', second:'2-digit'
      }).replace(/,/g,'');
    } catch(e) { return d.toString(); }
  }

  // ---------------- DOM ----------------
  const tableBody = safeQuery('#entries-table-body');
  const totalEntriesCard = safeQuery('#total-entries');
  const processedEntriesCard = safeQuery('#processed-entries');
  const rejectedEntriesCard = safeQuery('#rejected-entries');
  const downloadBtn = safeQuery('#download-btn');
  const dropdownToggle = safeQuery('#dropdown-toggle');
  const dropdownMenu = safeQuery('#dropdown-menu');
  const datePickerDiv = safeQuery('#date-picker');
  const dateRange = safeQuery('#date-range');
  const dateInput = safeQuery('#date-input');
  const userAvatarEl = safeQuery('#user-avatar');
  const profileMenuEl = safeQuery('#profile-menu');
  const profileNameEl = safeQuery('#profile-name');
  const profileEmailEl = safeQuery('#profile-email');
  const profileAvatarEl = safeQuery('#profile-avatar');
  const btnLogout = safeQuery('#btn-logout');

  // ---------------- STATE ----------------
  let currentEntries = [];
  let mappedEntries = [];
  let filteredEntries = [];
  let sortConfig = { column: null, direction: 'asc' };
  let columnFilters = {};
  let activeSearchColumn = null;
  let selectedRange = { start: null, end: null };
  let statusFilter = null;
  let pollHandle = null;

  // ---------------- MAPPING ----------------
  function mapEntries(raw = []) {
    return (raw || []).map(e => {
      const contact = e.contact || `${e.firstName || ''} ${e.lastName || ''}`.trim() || e.name || '';
      const parts = contact.split(' ').filter(Boolean);
      const firstName = parts[0] || (e.firstName || '');
      const lastName = parts.slice(1).join(' ') || (e.lastName || '');
      const rawTimestamp = normalizeTimestamp(e.timestamp ?? e.processTime ?? e.time ?? null);
      const processTime = rawTimestamp ? formatDateLocal(rawTimestamp) : 'Invalid Date';
      const status = (e.status || e._status || (e.approved ? 'processed' : (e.rejected ? 'rejected' : 'processed')) || '').toString().toLowerCase();
      return { firstName, lastName, country: e.country || e.location || 'Unknown', processTime, rawTimestamp, status, _orig: e };
    });
  }

  // ---------------- SORT INDICATOR ----------------
  function updateSortIndicators() {
    safeQueryAll('.sort-indicator').forEach(ind => { ind.textContent = '⇅'; });
    if (sortConfig.column) {
      const el = safeQuery(`th[data-column="${sortConfig.column}"] .sort-indicator`);
      if (el) el.textContent = sortConfig.direction === 'asc' ? '↑' : '↓';
    }
  }

  // ---------------- FILTER / SORT / RENDER ----------------
  function applyFiltersAndSort() {
    let all = Array.isArray(mappedEntries) ? [...mappedEntries] : [];

    if (statusFilter === 'processed') {
      all = all.filter(it => (it.status || '').toLowerCase() === 'processed' || (it._orig && (it._orig.approved || it._orig._approved)));
    } else if (statusFilter === 'rejected') {
      all = all.filter(it => (it.status || '').toLowerCase() === 'rejected' || (it._orig && (it._orig.rejected || it._orig._rejected)));
    }

    all = all.filter(item => {
      for (const [col, term] of Object.entries(columnFilters)) {
        const val = String(item[col] ?? '').toLowerCase();
        if (!val.includes(term)) return false;
      }
      return true;
    });

    if (selectedRange.start && selectedRange.end) {
      const start = new Date(selectedRange.start); start.setHours(0,0,0,0);
      const end = new Date(selectedRange.end); end.setHours(23,59,59,999);
      all = all.filter(it => it.rawTimestamp && it.rawTimestamp.getTime() >= start.getTime() && it.rawTimestamp.getTime() <= end.getTime());
    }

    if (sortConfig.column) {
      const col = sortConfig.column;
      all.sort((a,b) => {
        if (col === 'processTime') {
          const aT = a.rawTimestamp ? a.rawTimestamp.getTime() : -Infinity;
          const bT = b.rawTimestamp ? b.rawTimestamp.getTime() : -Infinity;
          return sortConfig.direction === 'asc' ? aT - bT : bT - aT;
        }
        const aV = String(a[col] ?? '').toLowerCase();
        const bV = String(b[col] ?? '').toLowerCase();
        return sortConfig.direction === 'asc' ? aV.localeCompare(bV) : bV.localeCompare(aV);
      });
    }

    filteredEntries = all;
    renderFilteredData();
  }

  function renderFilteredData() {
    if (!tableBody) return;
    tableBody.innerHTML = '';
    if (!filteredEntries || filteredEntries.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = '<td colspan="4" style="text-align:center; color:#9ca3af;">No matching entries</td>';
      tableBody.appendChild(row);
      return;
    }
    filteredEntries.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${escapeHtml(item.firstName)}</td>
        <td>${escapeHtml(item.lastName)}</td>
        <td>${escapeHtml(item.country)}</td>
        <td>${escapeHtml(item.processTime)}</td>
      `;
      tableBody.appendChild(row);
    });
    updateStats();
  }

  // ---------------- STATS ----------------
  function updateStats() {
    const arr = Array.isArray(mappedEntries) ? mappedEntries : [];
    const total = arr.length;
    const processed = arr.filter(e => (e.status || '').toLowerCase() === 'processed' || (e._orig && (e._orig.approved || e._orig._approved))).length;
    const rejected = arr.filter(e => (e.status || '').toLowerCase() === 'rejected' || (e._orig && (e._orig.rejected || e._orig._rejected))).length;
    if (totalEntriesCard) totalEntriesCard.textContent = String(total);
    if (processedEntriesCard) processedEntriesCard.textContent = String(processed);
    if (rejectedEntriesCard) rejectedEntriesCard.textContent = String(rejected);
  }

  // ---------------- CSV ----------------
  function downloadData() {
    const headers = ['First Name','Last Name','Country','Process Time'];
    let csv = headers.join(',') + '\n';
    (filteredEntries || []).forEach(row => {
      csv += `"${(row.firstName||'').replace(/"/g,'""')}","${(row.lastName||'').replace(/"/g,'""')}","${(row.country||'').replace(/"/g,'""')}","${(row.processTime||'').replace(/"/g,'""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-data-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  // ---------------- SEARCH CONTAINERS ----------------
  function closeAllSearchContainers() {
    document.querySelectorAll('.column-search-container.active').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('th.search-active').forEach(h => h.classList.remove('search-active'));
    activeSearchColumn = null;
  }
  function toggleSearchContainer(header) {
    const searchContainer = header.querySelector('.column-search-container');
    const column = header.getAttribute('data-column');
    if (!searchContainer) return;
    if (activeSearchColumn === column) {
      searchContainer.classList.remove('active');
      header.classList.remove('search-active');
      activeSearchColumn = null;
      return;
    }
    closeAllSearchContainers();
    searchContainer.classList.add('active');
    header.classList.add('search-active');
    activeSearchColumn = column;
    const input = searchContainer.querySelector('.column-search');
    setTimeout(() => input && input.focus(), 50);
  }

  // ---------------- TABLE INTERACTIONS ----------------
  function setupTableInteractions() {
    safeQueryAll('th[data-column]').forEach(th => {
      const col = th.getAttribute('data-column');
      if (!col) return;
      th.addEventListener('click', (ev) => {
        if (ev.target && ev.target.closest && ev.target.closest('.column-search-container')) return;
        const isSortClick = !!ev.target.closest('.sort-indicator');
        if (!isSortClick) {
          toggleSearchContainer(th);
          if (activeSearchColumn === col) return;
        }
        if (sortConfig.column === col) sortConfig.direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
        else { sortConfig.column = col; sortConfig.direction = 'asc'; }
        updateSortIndicators();
        applyFiltersAndSort();
      });

      const input = th.querySelector('.column-search');
      if (input) {
        input.addEventListener('click', e => e.stopPropagation());
        input.addEventListener('input', (e) => {
          const v = (e.target.value || '').trim();
          if (!v) delete columnFilters[col];
          else columnFilters[col] = v.toLowerCase();
          applyFiltersAndSort();
        });
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('th')) closeAllSearchContainers();
    });
  }

  // ---------------- STAT CARD FILTERS ----------------
  function setupStatCardFilters() {
    const totalEl = safeQuery('#stat-total');
    const processedEl = safeQuery('#stat-processed');
    const rejectedEl = safeQuery('#stat-rejected');

    function setActiveCard(key) {
      [totalEl, processedEl, rejectedEl].forEach(el => el && el.classList.remove('active'));
      if (key === 'total' && totalEl) totalEl.classList.add('active');
      if (key === 'processed' && processedEl) processedEl.classList.add('active');
      if (key === 'rejected' && rejectedEl) rejectedEl.classList.add('active');
    }

    if (totalEl) totalEl.addEventListener('click', () => { statusFilter = null; setActiveCard('total'); applyFiltersAndSort(); });
    if (processedEl) processedEl.addEventListener('click', () => { statusFilter = 'processed'; setActiveCard('processed'); applyFiltersAndSort(); });
    if (rejectedEl) rejectedEl.addEventListener('click', () => { statusFilter = 'rejected'; setActiveCard('rejected'); applyFiltersAndSort(); });

    setActiveCard('total');
  }

  // ---------------- FLATPICKR ----------------
  (function setupFlatpickrDefensive() {
    if (!datePickerDiv || !dateRange || !dateInput) return;
    function init() {
      try {
        const initialText = (dateRange.textContent || '').trim();
        let defaultDates;
        if (initialText && initialText.includes('-')) {
          const parts = initialText.split('-').map(s=>s.trim());
          const d1 = normalizeTimestamp(parts[0]), d2 = normalizeTimestamp(parts[1]);
          if (d1 && d2) defaultDates = [d1, d2];
        }
        if (typeof flatpickr === 'undefined') {
          datePickerDiv.addEventListener('click', (e) => { e.preventDefault(); alert('Calendar library not loaded.'); });
          return;
        }
        const fp = flatpickr(dateInput, {
          mode:'range',
          dateFormat:'d-m-Y',
          defaultDate: defaultDates || undefined,
          clickOpens: false,
          onChange: function(selectedDates, dateStr, instance) {
            if (selectedDates.length === 2) dateRange.textContent = `${instance.formatDate(selectedDates[0],"d-m-Y")} - ${instance.formatDate(selectedDates[1],"d-m-Y")}`;
            else if (selectedDates.length === 1) dateRange.textContent = instance.formatDate(selectedDates[0],"d-m-Y");
            else dateRange.textContent = 'All dates';
            if (selectedDates.length === 2) { selectedRange.start = selectedDates[0].toISOString(); selectedRange.end = selectedDates[1].toISOString(); }
            else selectedRange = { start: null, end: null };
            applyFiltersAndSort();
          }
        });
        datePickerDiv.addEventListener('click', (e)=> { e.preventDefault(); fp.open(); });
      } catch (err) { console.error('flatpickr init failed', err); }
    }

    if (typeof flatpickr !== 'undefined') { init(); return; }
    const scriptExists = Array.from(document.scripts).some(s => (s.src||'').includes('flatpickr.min.js'));
    if (scriptExists) { setTimeout(init, 200); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js';
    s.async = true;
    s.onload = init;
    s.onerror = () => { console.error('Failed to load flatpickr from CDN'); init(); };
    document.head.appendChild(s);
  })();

  // ---------------- DROPDOWN ----------------
  function setupDropdown() {
    if (!dropdownToggle || !dropdownMenu) return;
    dropdownToggle.addEventListener('click', (e) => { e.stopPropagation(); dropdownMenu.classList.toggle('show'); });
    document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
    dropdownMenu.addEventListener('click', (e) => e.stopPropagation());
    dropdownMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', updateSelectedCategories));
    updateSelectedCategories();
  }
  function updateSelectedCategories() {
    if (!dropdownMenu) return;
    const selected = [];
    dropdownMenu.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      const lbl = cb.nextElementSibling ? cb.nextElementSibling.textContent : cb.id;
      if (lbl) selected.push(lbl.trim());
    });
    const sel = safeQuery('#selected-category');
    if (!sel) return;
    sel.textContent = selected.length === 0 ? 'Select categories' : (selected.length === 1 ? selected[0] : `${selected.length} selected`);
  }

  // ---------------- PROFILE + LOGOUT ----------------
  async function loadProfile() {
    try {
      const res = await chromeStorageGet('kosh_auth');
      const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
      if (auth && auth.user) {
        const user = auth.user;
        if (profileNameEl) profileNameEl.textContent = user.name || user.email || 'User';
        if (profileEmailEl) profileEmailEl.textContent = user.email || '';
        const initial = (user.name || user.email || 'V')[0].toUpperCase();
        if (profileAvatarEl) profileAvatarEl.textContent = initial;
        if (userAvatarEl) userAvatarEl.textContent = initial;
      } else {
        if (profileNameEl) profileNameEl.textContent = 'Guest';
        if (profileEmailEl) profileEmailEl.textContent = 'Not signed in';
        if (profileAvatarEl) profileAvatarEl.textContent = 'V';
        if (userAvatarEl) userAvatarEl.textContent = 'V';
      }
    } catch (err) { console.warn('loadProfile failed', err); }
  }

  if (userAvatarEl && profileMenuEl) {
    userAvatarEl.addEventListener('click', (e) => { e.stopPropagation(); profileMenuEl.classList.toggle('show'); profileMenuEl.setAttribute('aria-hidden', profileMenuEl.classList.contains('show') ? 'false' : 'true'); });
    document.addEventListener('click', () => { profileMenuEl.classList.remove('show'); profileMenuEl.setAttribute('aria-hidden','true'); });
    profileMenuEl.addEventListener('click', e => e.stopPropagation());
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await chromeStorageRemove('kosh_auth');
        try { localStorage.removeItem('kosh_auth'); } catch(e){}
        if (typeof firebase !== 'undefined' && firebase && firebase.auth) {
          try { await firebase.auth().signOut(); } catch(e){ console.warn('firebase signOut failed', e); }
        }
        try { window.location.href = '/auth.html'; } catch(e) { console.warn('navigate to auth failed', e); }
        try { window.close(); } catch(e){}
      } catch (err) { console.error('logout error', err); }
    });
  }

  // ---------------- BACKEND AUTH HELPERS ----------------
  async function getAuthToken() {
    try {
      const user = (window.__KOSH__ && window.__KOSH__.auth && window.__KOSH__.auth.currentUser) || (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
      if (user && typeof user.getIdToken === 'function') return await user.getIdToken();
      const res = await chromeStorageGet('kosh_auth');
      const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
      if (auth && auth.token) return auth.token;
      return null;
    } catch (err) { console.warn('getAuthToken failed', err); return null; }
  }

  // ---------------- FETCH / SAVE / CLEANUP ----------------
  async function fetchEntriesOnce() {
    try {
      const token = await getAuthToken();
      const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
      const resp = await fetch((window.API_BASE_URL || '') + '/api/entries', { method: 'GET', headers });
      if (!resp.ok) {
        console.warn('/api/entries returned', resp.status);
        if (!mappedEntries || mappedEntries.length === 0) mappedEntries = mapEntries(DEFAULT_ENTRIES);
        applyFiltersAndSort();
        return;
      }
      const payload = await resp.json().catch(()=>null);
      if (payload && payload.success && Array.isArray(payload.entries)) {
        currentEntries = payload.entries;
        mappedEntries = mapEntries(currentEntries);
        applyFiltersAndSort();
      } else {
        if (!mappedEntries || mappedEntries.length === 0) mappedEntries = mapEntries(DEFAULT_ENTRIES);
        applyFiltersAndSort();
      }
    } catch (err) {
      console.error('fetchEntriesOnce error', err);
      if (!mappedEntries || mappedEntries.length === 0) mappedEntries = mapEntries(DEFAULT_ENTRIES);
      applyFiltersAndSort();
    }
  }

  function startPollingEntries() {
    if (pollHandle) return;
    if (!mappedEntries || mappedEntries.length === 0) {
      mappedEntries = mapEntries(DEFAULT_ENTRIES);
      applyFiltersAndSort();
    }
    fetchEntriesOnce();
    pollHandle = setInterval(fetchEntriesOnce, POLL_MS);
    setTimeout(cleanupOldData, 2000);
    setInterval(cleanupOldData, 24*60*60*1000);
  }

  async function cleanupOldData() {
    try {
      const token = await getAuthToken();
      const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
      const resp = await fetch((window.API_BASE_URL || '') + '/api/cleanup', {
        method:'POST',
        headers,
        body: JSON.stringify({ retentionDays: 30 })
      });
      if (!resp.ok) { console.warn('/api/cleanup returned', resp.status); return; }
      const data = await resp.json().catch(()=>null);
      if (!data || !data.success) console.warn('/api/cleanup response', data);
    } catch (err) { console.error('cleanupOldData error', err); }
  }

  async function saveEntryToBackend(entry) {
    try {
      const token = await getAuthToken();
      const headers = Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': 'Bearer ' + token } : {});
      const resp = await fetch((window.API_BASE_URL || '') + '/api/saveEntry', {
        method: 'POST', headers, body: JSON.stringify({ entry })
      });
      if (!resp.ok) { console.warn('/api/saveEntry returned', resp.status); return false; }
      const data = await resp.json().catch(()=>null);
      return data && data.success;
    } catch (err) { console.error('saveEntryToBackend error', err); return false; }
  }

  // ---------------- TEST HELPERS ----------------
  window.__KOSH__ = window.__KOSH__ || {};
  window.__KOSH__.setEntries = function(rawEntries) {
    currentEntries = Array.isArray(rawEntries) ? rawEntries : [];
    mappedEntries = mapEntries(currentEntries);
    applyFiltersAndSort();
  };

  // ---------------- INIT ----------------
  function init() {
    try {
      setupTableInteractions();
      setupDropdown();
      setupStatCardFilters();
      updateSortIndicators();
      loadProfile();
      if (!mappedEntries || mappedEntries.length === 0) {
        mappedEntries = mapEntries(DEFAULT_ENTRIES);
        applyFiltersAndSort();
      }
      startPollingEntries();
      if (downloadBtn) downloadBtn.addEventListener('click', (e)=>{ e.preventDefault(); downloadData(); });
    } catch (err) { console.error('init error', err); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
