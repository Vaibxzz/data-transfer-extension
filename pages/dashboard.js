// dashboard.js (updated: clickable stats, removed retention UI, modern download icon hookup)
function waitForFirebaseReady(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (window.firebase && firebase.apps && firebase.apps.length > 0) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Firebase not ready'));
      setTimeout(check, 50);
    })();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('Dashboard DOM loaded');

  // --- FIREBASE INIT (auth only) ---
  const firebaseConfig = {
    apiKey: "AIzaSyAddUryOENzoRqCCaIO_5GPduBsYGI512k",
    authDomain: "nimble-falcon-38ada.firebaseapp.com",
    projectId: "nimble-falcon-38ada",
    storageBucket: "nimble-falcon-38ada.firebasestorage.app",
    messagingSenderId: "1094058263345",
    appId: "1:1094058263345:web:6ce5920eb3bca28b576610"
  };
  if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    try { firebase.initializeApp(firebaseConfig); }
    catch(e){ console.warn('Firebase init warning:', e); }
  }

  // --- elements & state ---
  const tableBody = document.getElementById('entries-table-body');
  const totalEntriesCard = document.getElementById('total-entries');
  const processedEntriesCard = document.getElementById('processed-entries');
  const rejectedEntriesCard = document.getElementById('rejected-entries');
  const downloadBtn = document.getElementById('download-btn');
  const emptyState = document.getElementById('empty-state');
  const dropdownToggle = document.getElementById('dropdown-toggle');
  const dropdownMenu = document.getElementById('dropdown-menu');
  const datePickerDiv = document.getElementById('date-picker');
  const dateRange = document.getElementById('date-range');
  const dateInput = document.getElementById('date-input');
  const userAvatarEl = document.getElementById('user-avatar');
  const profileMenuEl = document.getElementById('profile-menu');
  const profileNameEl = document.getElementById('profile-name');
  const profileEmailEl = document.getElementById('profile-email');
  const profileAvatarEl = document.getElementById('profile-avatar');
  const btnLogout = document.getElementById('btn-logout');

  let currentEntries = [];   // raw from backend
  let mappedEntries = [];    // mapped for UI
  let filteredEntries = [];
  let sortConfig = { column: null, direction: 'asc' };
  let columnFilters = {};
  let activeSearchColumn = null;
  let selectedRange = { start: null, end: null };
  let statusFilter = null; // null | 'processed' | 'rejected'
  let subscriptionStarted = false;

  // ---------- storage helpers ----------
  function chromeStorageGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, resolve);
      } else {
        const out = {};
        if (Array.isArray(keys)) {
          keys.forEach(k => { try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e){ out[k] = localStorage.getItem(k); } });
        } else if (typeof keys === 'string') {
          try { out[keys] = JSON.parse(localStorage.getItem(keys)); } catch(e) { out[keys] = localStorage.getItem(keys); }
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

  // ---------- timestamp helpers ----------
  function normalizeTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number' && !isNaN(value)) {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        if (trimmed.length === 10) return new Date(parseInt(trimmed,10)*1000);
        return new Date(parseInt(trimmed,10));
      }
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d;
      const match = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
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
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).replace(/,/g, '');
    } catch (e) { return d.toString(); }
  }

  function mapEntries(rawEntries) {
    return (rawEntries || []).map(e => {
      const contact = e.contact || e.name || '';
      const parts = contact.split(' ').filter(Boolean);
      const firstName = parts[0] || (e.firstName || '');
      const lastName = parts.slice(1).join(' ') || (e.lastName || '');
      const rawTimestamp = normalizeTimestamp(e.timestamp ?? e.processTime ?? e.time ?? null);
      const processTime = rawTimestamp ? formatDateLocal(rawTimestamp) : 'Invalid Date';
      // status fallback: use provided status or infer 'processed' by default
      const status = (e.status || e._status || e.state || '').toString().toLowerCase() || (e.approved ? 'processed' : (e.rejected ? 'rejected' : 'processed'));
      return { firstName, lastName, country: e.country || e.location || 'Unknown', processTime, rawTimestamp, status, _orig: e };
    });
  }

  // ---------- table interactions ----------
  function setupTableInteractions() {
    const headers = document.querySelectorAll('th[data-column]');
    headers.forEach(header => {
      header.addEventListener('click', (e) => {
        const column = header.dataset.column;
        if (e.target.closest('.column-search-container')) return;
        toggleSearchContainer(header);
        if (activeSearchColumn === column) return;
        handleSort(column);
      });
      const searchInput = header.querySelector('.column-search');
      if (searchInput) {
        searchInput.addEventListener('input', (ev) => { ev.stopPropagation(); handleColumnSearch(header.dataset.column, ev.target.value); });
        searchInput.addEventListener('click', (ev) => ev.stopPropagation());
      }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('th')) closeAllSearchContainers(); });
  }
  function toggleSearchContainer(header) {
    const searchContainer = header.querySelector('.column-search-container');
    const column = header.dataset.column;
    if (!searchContainer) return;
    if (activeSearchColumn === column) {
      searchContainer.classList.remove('active'); header.classList.remove('search-active'); activeSearchColumn = null; return;
    }
    closeAllSearchContainers();
    searchContainer.classList.add('active'); header.classList.add('search-active'); activeSearchColumn = column;
    const searchInput = searchContainer.querySelector('.column-search'); setTimeout(()=>searchInput && searchInput.focus(),50);
  }
  function closeAllSearchContainers() {
    document.querySelectorAll('.column-search-container.active').forEach(c=>c.classList.remove('active'));
    document.querySelectorAll('th.search-active').forEach(h=>h.classList.remove('search-active'));
    activeSearchColumn = null;
  }
  function handleSort(column) {
    if (sortConfig.column === column) sortConfig.direction = (sortConfig.direction === 'asc') ? 'desc' : 'asc';
    else { sortConfig.column = column; sortConfig.direction = 'asc'; }
    updateSortIndicators(); applyFiltersAndSort();
  }
  function updateSortIndicators() {
    document.querySelectorAll('.sort-indicator').forEach(ind => ind.textContent = '⇅');
    if (sortConfig.column) {
      const el = document.querySelector(`th[data-column="${sortConfig.column}"] .sort-indicator`);
      if (el) el.textContent = sortConfig.direction === 'asc' ? '↑' : '↓';
    }
  }
  function handleColumnSearch(column, searchTerm) {
    if (!searchTerm || searchTerm.trim()==='') delete columnFilters[column]; else columnFilters[column] = searchTerm.toLowerCase();
    applyFiltersAndSort();
  }

  // ---------- FILTER / SORT / RENDER ----------
  function applyFiltersAndSort() {
    // static entries retained as before (now include status field)
    const staticEntries = [
      {firstName:'Maria', lastName:'Anders', country:'Germany', processTime:'Invalid Date', rawTimestamp:null, status:'processed', _orig:{}},
      {firstName:'Maria', lastName:'Anders', country:'Germany', processTime:'Invalid Date', rawTimestamp:null, status:'processed', _orig:{}}
    ];
    // mappedEntries come from backend fetch mapping
    let all = [...staticEntries, ...mappedEntries];

    // apply column text filters
    all = all.filter(item => {
      for (const [column, term] of Object.entries(columnFilters)) {
        let val = String(item[column] ?? '').toLowerCase();
        if (!val.includes(term)) return false;
      }
      return true;
    });

    // apply selected date range if set (uses rawTimestamp)
    if (selectedRange.start && selectedRange.end) {
      const start = new Date(selectedRange.start); start.setHours(0,0,0,0);
      const end = new Date(selectedRange.end); end.setHours(23,59,59,999);
      all = all.filter(item => item.rawTimestamp && item.rawTimestamp.getTime() >= start.getTime() && item.rawTimestamp.getTime() <= end.getTime());
    }

    // apply status filter from stat cards
    if (statusFilter && (statusFilter === 'processed' || statusFilter === 'rejected')) {
      all = all.filter(item => (item.status || '').toLowerCase() === statusFilter);
    }

    // sorting
    if (sortConfig.column) {
      const col = sortConfig.column;
      all.sort((a,b) => {
        if (col === 'processTime') {
          const aTime = a.rawTimestamp ? a.rawTimestamp.getTime() : -Infinity;
          const bTime = b.rawTimestamp ? b.rawTimestamp.getTime() : -Infinity;
          return (aTime < bTime) ? (sortConfig.direction === 'asc' ? -1 : 1) : (aTime > bTime ? (sortConfig.direction === 'asc' ? 1 : -1) : 0);
        } else {
          const aVal = String(a[col] ?? '').toLowerCase();
          const bVal = String(b[col] ?? '').toLowerCase();
          return aVal < bVal ? (sortConfig.direction === 'asc' ? -1 : 1) : aVal > bVal ? (sortConfig.direction === 'asc' ? 1 : -1) : 0;
        }
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
      row.innerHTML = '<td colspan="4" style="text-align:center; color:#9ca3af;">No matching entries found</td>';
      tableBody.appendChild(row);
    } else {
      filteredEntries.forEach(item => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${escapeHtml(item.firstName || '')}</td>
          <td>${escapeHtml(item.lastName || '')}</td>
          <td>${escapeHtml(item.country || '')}</td>
          <td>${escapeHtml(item.processTime || 'Invalid Date')}</td>
        `;
        tableBody.appendChild(row);
      });
    }
    updateStats();
  }

  function updateStats() {
    // compute counts from combined dataset BEFORE status filter (so counts always represent full set)
    const staticEntries = [
      {status:'processed'},
      {status:'processed'}
    ];
    const combined = [...staticEntries, ...mappedEntries.map(e => ({status: (e.status||'processed').toLowerCase()}))];
    const totalCount = combined.length;
    const processedCount = combined.filter(c => (c.status || '').toLowerCase() === 'processed').length;
    const rejectedCount = combined.filter(c => (c.status || '').toLowerCase() === 'rejected').length;

    if (totalEntriesCard) totalEntriesCard.textContent = totalCount;
    if (processedEntriesCard) processedEntriesCard.textContent = processedCount;
    if (rejectedEntriesCard) rejectedEntriesCard.textContent = rejectedCount;

    // visually set active stat card
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    if (!statusFilter && document.getElementById('stat-total')) document.getElementById('stat-total').classList.add('active');
    if (statusFilter === 'processed' && document.getElementById('stat-processed')) document.getElementById('stat-processed').classList.add('active');
    if (statusFilter === 'rejected' && document.getElementById('stat-rejected')) document.getElementById('stat-rejected').classList.add('active');
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  // ---------- Dropdown category handling ----------
  if (dropdownToggle && dropdownMenu) {
    dropdownToggle.addEventListener('click', (e) => { e.stopPropagation(); dropdownMenu.classList.toggle('show'); });
    document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
    dropdownMenu.addEventListener('click', (e) => e.stopPropagation());
    dropdownMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', updateSelectedCategories));
  }
  function updateSelectedCategories() {
    const selected = [];
    dropdownMenu.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => selected.push(cb.nextElementSibling.textContent));
    const sel = document.getElementById('selected-category');
    if (!sel) return;
    sel.textContent = selected.length === 0 ? 'Select categories' : (selected.length === 1 ? selected[0] : `${selected.length} selected`);
  }

  // ---------- Flatpickr ----------
  (function setupFlatpickr() {
    if (!datePickerDiv || !dateRange || !dateInput) return;
    if (typeof flatpickr === 'undefined') {
      datePickerDiv.addEventListener('click', (e) => { e.preventDefault(); alert('Calendar library not loaded. Please include flatpickr.min.js.'); });
      return;
    }
    const initialText = (dateRange.textContent || '').trim();
    let defaultDates;
    if (initialText && initialText.includes('-')) {
      const parts = initialText.split('-').map(s=>s.trim());
      const d1 = normalizeTimestamp(parts[0]);
      const d2 = normalizeTimestamp(parts[1]);
      if (d1 && d2) defaultDates = [d1, d2];
    }
    const fp = flatpickr(dateInput, {
      mode: 'range',
      dateFormat: 'd-m-Y',
      defaultDate: defaultDates || undefined,
      clickOpens: false,
      onChange: function(selectedDates, dateStr, instance) {
        if (selectedDates.length === 2) {
          dateRange.textContent = `${instance.formatDate(selectedDates[0],"d-m-Y")} - ${instance.formatDate(selectedDates[1],"d-m-Y")}`;
          selectedRange.start = selectedDates[0];
          selectedRange.end = selectedDates[1];
        } else if (selectedDates.length === 1) {
          dateRange.textContent = instance.formatDate(selectedDates[0],"d-m-Y");
          selectedRange.start = selectedDates[0];
          selectedRange.end = selectedDates[0];
        } else {
          dateRange.textContent = 'All dates';
          selectedRange = { start: null, end: null };
        }
        applyFiltersAndSort();
      }
    });
    datePickerDiv.addEventListener('click', function(e){ e.preventDefault(); fp.open(); });
  })();

  // ---------- Profile Menu / Auth UI ----------
  async function loadProfile() {
    const res = await chromeStorageGet('kosh_auth');
    const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
    if (auth && auth.user) {
      const user = auth.user;
      profileNameEl.textContent = user.name || user.email || 'User';
      profileEmailEl.textContent = user.email || '';
      const initial = (user.name || user.email || 'S')[0].toUpperCase();
      profileAvatarEl.textContent = initial; if (userAvatarEl) userAvatarEl.textContent = initial;
    } else {
      profileNameEl.textContent = 'Guest'; profileEmailEl.textContent = 'Not signed in'; profileAvatarEl.textContent = 'S'; if (userAvatarEl) userAvatarEl.textContent = 'S';
    }
  }
  if (userAvatarEl && profileMenuEl) {
    userAvatarEl.addEventListener('click', (e)=>{ e.stopPropagation(); profileMenuEl.classList.toggle('show'); profileMenuEl.setAttribute('aria-hidden', profileMenuEl.classList.contains('show') ? 'false' : 'true'); });
    document.addEventListener('click', ()=>{ profileMenuEl.classList.remove('show'); profileMenuEl.setAttribute('aria-hidden','true'); });
    profileMenuEl.addEventListener('click', (e)=> e.stopPropagation());
  }
  if (btnLogout) {
    btnLogout.addEventListener('click', async (e) => {
      e.preventDefault();
      await chromeStorageRemove('kosh_auth');
      try { localStorage.removeItem('kosh_auth'); } catch(e){}
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        try { chrome.tabs.create({ url: chrome.runtime.getURL('auth.html'), active: true }); } catch(e){ if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage(); else window.location.href='auth.html'; }
      } else window.location.href = 'auth.html';
      try { window.close(); } catch(e){}
    });
  }

  // ---------- CSV Download ----------
  function downloadData() {
    const headers = ['First Name','Last Name','Country','Process Time'];
    let csv = headers.join(',') + '\n';
    filteredEntries.forEach(entry => { csv += `"${entry.firstName||''}","${entry.lastName||''}","${entry.country||''}","${entry.processTime||''}"\n`; });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `reconciliation-data-${new Date().toISOString().split('T')[0]}.csv`; link.click();
    window.URL.revokeObjectURL(url);
  }
  if (downloadBtn) downloadBtn.addEventListener('click', downloadData);

  // ---------- STAT CARD CLICK FILTERS ----------
  const statTotalEl = document.getElementById('stat-total');
  const statProcessedEl = document.getElementById('stat-processed');
  const statRejectedEl = document.getElementById('stat-rejected');

  function toggleStatusFilter(newStatus) {
    if (statusFilter === newStatus) statusFilter = null;
    else statusFilter = newStatus;
    applyFiltersAndSort();
  }
  if (statTotalEl) statTotalEl.addEventListener('click', () => { statusFilter = null; applyFiltersAndSort(); });
  if (statProcessedEl) statProcessedEl.addEventListener('click', () => toggleStatusFilter('processed'));
  if (statRejectedEl) statRejectedEl.addEventListener('click', () => toggleStatusFilter('rejected'));

  // ---------- BACKEND SUBSCRIBE (polling) ----------
  async function subscribeToData() {
    try {
      // ensure user exists in stored auth if firebase not present
      const res = await chromeStorageGet('kosh_auth');
      const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
      if (!auth || !auth.user || !auth.user.id) {
        // proceed anyway; backend may accept unauth requests depending on your config
        console.log('No stored user id found — attempting to fetch entries anyway (backend must allow).');
      }

      async function fetchAndApplyEntries() {
        try {
          let idToken = null;
          const currentUser = window.__KOSH__?.auth?.currentUser;
          if (currentUser && typeof currentUser.getIdToken === 'function') idToken = await currentUser.getIdToken();
          else {
            const r = await chromeStorageGet('kosh_auth');
            const a = r && r.kosh_auth ? r.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
            if (a && a.token) idToken = a.token;
          }

          const resp = await fetch((window.API_BASE_URL || '') + '/entries', {
            method: 'GET',
            headers: Object.assign({}, idToken ? { 'Authorization': 'Bearer ' + idToken } : {})
          });

          if (!resp.ok) {
            console.warn('[subscribeToData] backend /entries returned', resp.status);
            currentEntries = [];
            mappedEntries = mapEntries([]);
            applyFiltersAndSort();
            return;
          }
          const payload = await resp.json().catch(()=>({success:false}));
          if (payload && payload.success && Array.isArray(payload.entries)) {
            currentEntries = payload.entries;
            mappedEntries = mapEntries(currentEntries);
            applyFiltersAndSort();
          } else {
            // fallback to empty
            mappedEntries = mapEntries([]);
            applyFiltersAndSort();
          }
        } catch (err) {
          console.error('[subscribeToData] fetch error', err);
          mappedEntries = mapEntries([]);
          applyFiltersAndSort();
        }
      }

      await fetchAndApplyEntries();
      const POLL_MS = 30 * 1000;
      setInterval(fetchAndApplyEntries, POLL_MS);

      // scheduled cleanup: retention preference is backend-only (value stored in localStorage)
      setTimeout(cleanupOldData, 2000);
      setInterval(cleanupOldData, 24 * 60 * 60 * 1000);

    } catch (err) {
      console.error("subscribeToData error", err);
      mappedEntries = mapEntries([]);
      applyFiltersAndSort();
    }
  }

  // Prevent duplicate subscription starts
  function startSubscriptionOnce() {
    if (subscriptionStarted) return false;
    subscriptionStarted = true;
    subscribeToData().catch(err => console.error('subscribe err', err));
    return true;
  }

  // ---------- AUTO-DELETION PREFERENCE (backend-only) ----------
  let userPreference = 30;
  const RETENTION_STORAGE_KEY = 'approvedEntriesRetentionDays';
  const storedPref = localStorage.getItem(RETENTION_STORAGE_KEY);
  if (storedPref && !isNaN(Number(storedPref))) userPreference = Number(storedPref);
  function setRetentionPreference(days) {
    if (!isNaN(Number(days)) && Number(days) > 0) {
      userPreference = Number(days);
      localStorage.setItem(RETENTION_STORAGE_KEY, String(userPreference));
    }
  }
  async function cleanupOldData() {
    try {
      const user = window.__KOSH__?.auth?.currentUser;
      let idToken = null;
      if (user && typeof user.getIdToken === 'function') idToken = await user.getIdToken();
      else {
        const res = await chromeStorageGet('kosh_auth');
        const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
        if (auth && auth.token) idToken = auth.token;
      }

      const url = (window.API_BASE_URL || '') + '/cleanup';
      const resp = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, idToken ? { 'Authorization': 'Bearer ' + idToken } : {}),
        body: JSON.stringify({ retentionDays: userPreference })
      });

      if (!resp.ok) {
        console.warn('[cleanupOldData] backend returned', resp.status);
        return;
      }
      const data = await resp.json().catch(()=>({success:false}));
      if (!data.success) console.warn('[cleanupOldData] backend response:', data);
      else console.log('[cleanupOldData] backend cleaned up entries:', data.deletedCount ?? '(unknown)');
    } catch (err) {
      console.error('[cleanupOldData] error:', err);
    }
  }

  // ---------- Save entry helper (keeps existing behavior) ----------
  async function saveEntryToFirestore(entry) {
    try {
      let idToken = null;
      const user = window.__KOSH__?.auth?.currentUser || (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
      if (user && typeof user.getIdToken === 'function') {
        idToken = await user.getIdToken();
      } else {
        const res = await chromeStorageGet('kosh_auth');
        const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
        if (auth && auth.token) idToken = auth.token;
      }
      const res2 = await chromeStorageGet('kosh_auth');
      const auth2 = res2 && res2.kosh_auth ? res2.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
      const userId = auth2 && auth2.user && auth2.user.id ? auth2.user.id : undefined;

      if (!window.API_BASE_URL) console.warn('window.API_BASE_URL not defined');

      const headers = { 'Content-Type': 'application/json' };
      if (idToken) headers['Authorization'] = 'Bearer ' + idToken;

      const response = await fetch((window.API_BASE_URL || '') + '/saveEntry', {
        method: 'POST',
        headers,
        body: JSON.stringify({ entry, userId })
      });

      if (!response.ok) {
        const txt = await response.text().catch(()=>null);
        console.error('[Backend] saveEntry returned status', response.status, txt);
        return;
      }
      const data = await response.json().catch(()=>({success:false}));
      if (!data.success) console.error('[Backend] Save failed:', data);
      else console.log('[Backend] Entry saved successfully.');
    } catch (err) {
      console.error('[Backend] Error saving entry:', err);
    }
  }

  // ---------- Misc helpers ----------
  function escapeHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  // ---------- Init: table interactions, profile, subscription ----------
  setupTableInteractions();
  loadProfile();
  startSubscriptionOnce();

  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.onChanged.addListener((changes, ns) => { if (ns === 'local' && changes.kosh_auth) loadProfile(); });
  }
});