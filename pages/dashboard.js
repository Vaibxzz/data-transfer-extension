// dashboard.js (cleaned single-copy version)
// Backend-first dashboard: reads entries via backend /entries, saves via /saveEntry, cleanup via /cleanup.
// Keeps firebase init for auth token acquisition only (no direct Firestore reads).

document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard DOM loaded');
  
    // --- FIREBASE INITIALIZATION (auth only) ---
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
    // NOTE: we do not use firestore directly here for reads — backend handles persistence.
  
    // --- SAVE ENTRY TO BACKEND (PER USER) ---
    async function saveEntryToFirestore(entry) {
      try {
        // Get token from firebase auth if available
        let idToken = null;
        const user = window.__KOSH__?.auth?.currentUser || (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
        if (user && typeof user.getIdToken === 'function') {
          idToken = await user.getIdToken();
        } else {
          const res = await chromeStorageGet('kosh_auth');
          const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
          if (auth && auth.token) idToken = auth.token;
        }
  
        // If userId present in local stored auth, include it as fallback (backend should prefer token)
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
  
    // --- AUTO-DELETION PREFERENCE LOGIC ---
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
  
    // ---------- CLEANUP: call backend to remove old data (backend-only) ----------
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
  
    // ---------- SUBSCRIBE / LOAD DATA FROM BACKEND (replaces onSnapshot) ----------
    async function subscribeToData() {
      try {
        // Ensure there is a userId (either via firebase or stored kosh_auth)
        const user = window.__KOSH__?.auth?.currentUser;
        if (!user) {
          const res = await chromeStorageGet('kosh_auth');
          const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
          if (!auth || !auth.user || !auth.user.id) {
            console.error("Cannot subscribe to data: userId missing.");
            mappedEntries = [];
            applyFiltersAndSort();
            return;
          }
        }
  
        async function fetchAndApplyEntries() {
          try {
            let idToken = null;
            const currentUser = window.__KOSH__?.auth?.currentUser;
            if (currentUser && typeof currentUser.getIdToken === 'function') idToken = await currentUser.getIdToken();
            else {
              const res = await chromeStorageGet('kosh_auth');
              const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
              if (auth && auth.token) idToken = auth.token;
            }
  
            const resp = await fetch((window.API_BASE_URL || '') + '/entries', {
              method: 'GET',
              headers: Object.assign({}, idToken ? { 'Authorization': 'Bearer ' + idToken } : {})
            });
  
            if (!resp.ok) {
              console.warn('[subscribeToData] backend /entries returned', resp.status);
              mappedEntries = [];
              applyFiltersAndSort();
              return;
            }
            const payload = await resp.json().catch(()=>({success:false}));
            if (payload && payload.success && Array.isArray(payload.entries)) {
              currentEntries = payload.entries;
              mappedEntries = mapEntries(currentEntries);
              applyFiltersAndSort();
            } else {
              mappedEntries = [];
              applyFiltersAndSort();
            }
          } catch (err) {
            console.error('[subscribeToData] fetch error', err);
            mappedEntries = [];
            applyFiltersAndSort();
          }
        }
  
        // Initial fetch
        await fetchAndApplyEntries();
  
        // Poll periodically for updates
        const POLL_MS = 30 * 1000; // 30s by default (increase to reduce backend load)
        setInterval(fetchAndApplyEntries, POLL_MS);
  
        // Scheduled cleanup
        setTimeout(cleanupOldData, 2000);
        setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
  
      } catch (err) {
        console.error("subscribeToData error", err);
        mappedEntries = [];
        applyFiltersAndSort();
      }
    }
  
    // --- ELEMENT REFERENCES ---
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
  
    // internal state
    let currentEntries = [];
    let mappedEntries = [];
    let filteredEntries = [];
    let sortConfig = { column: null, direction: 'asc' };
    let columnFilters = {};
    let activeSearchColumn = null;
    let selectedRange = { start: null, end: null };
  
    // ---------- Utilities (storage fallback helpers) ----------
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
        const firstName = parts[0] || '';
        const lastName = parts.slice(1).join(' ') || '';
        const rawTimestamp = normalizeTimestamp(e.timestamp ?? e.processTime ?? e.time ?? null);
        const processTime = rawTimestamp ? formatDateLocal(rawTimestamp) : 'Invalid Date';
        return { firstName, lastName, country: e.country || e.location || 'Unknown', processTime, rawTimestamp, _orig: e };
      });
    }
  
    // ---------- table interactions (same as before) ----------
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
      const staticEntries = [
        {firstName:'Maria', lastName:'Anders', country:'Germany', processTime:'Invalid Date', rawTimestamp:null},
        {firstName:'Maria', lastName:'Anders', country:'Germany', processTime:'Invalid Date', rawTimestamp:null}
      ];
      let all = [...staticEntries, ...mappedEntries];
  
      all = all.filter(item => {
        for (const [column, term] of Object.entries(columnFilters)) {
          let val = String(item[column] ?? '').toLowerCase();
          if (!val.includes(term)) return false;
        }
        return true;
      });
  
      if (selectedRange.start && selectedRange.end) {
        const start = new Date(selectedRange.start); start.setHours(0,0,0,0);
        const end = new Date(selectedRange.end); end.setHours(23,59,59,999);
        all = all.filter(item => item.rawTimestamp && item.rawTimestamp.getTime() >= start.getTime() && item.rawTimestamp.getTime() <= end.getTime());
      }
  
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
      const totalCount = filteredEntries.length;
      if (totalEntriesCard) totalEntriesCard.textContent = totalCount;
      if (processedEntriesCard) processedEntriesCard.textContent = totalCount;
      if (rejectedEntriesCard) rejectedEntriesCard.textContent = '0';
    }
  
    function escapeHtml(str) {
      return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
    }
  
    // ---------- DROPDOWN ----------
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
  
    // ---------- FLATPICKR ----------
    (function setupFlatpickr() {
      const datePickerDiv = document.getElementById('date-picker');
      const dateRange = document.getElementById('date-range');
      const dateInput = document.getElementById('date-input');
      if (!datePickerDiv || !dateRange || !dateInput) return;
      if (typeof flatpickr === 'undefined') {
        datePickerDiv.addEventListener('click', (e) => { e.preventDefault(); alert('Calendar library not loaded. Please include flatpickr.min.js.'); });
        return;
      }
      const initialText = (dateRange.textContent || '').trim();
      let defaultDates;
      if (initialText && initialText.includes('-')) {
        const parts = initialText.split('-').map(s=>s.trim()); const d1 = normalizeTimestamp(parts[0]); const d2 = normalizeTimestamp(parts[1]);
        if (d1 && d2) defaultDates = [d1, d2];
      }
      const fp = flatpickr(dateInput, {
        mode: 'range', dateFormat: 'd-m-Y', defaultDate: defaultDates || undefined, clickOpens: false,
        onChange: function(selectedDates, dateStr, instance) {
          if (selectedDates.length === 2) dateRange.textContent = `${instance.formatDate(selectedDates[0],"d-m-Y")} - ${instance.formatDate(selectedDates[1],"d-m-Y")}`;
          else if (selectedDates.length === 1) dateRange.textContent = instance.formatDate(selectedDates[0],"d-m-Y");
          else dateRange.textContent = 'All dates';
          if (typeof applyFiltersAndSort === 'function') applyFiltersAndSort();
        }
      });
      datePickerDiv.addEventListener('click', function(e){ e.preventDefault(); fp.open(); });
    })();
  
    // ---------- PROFILE MENU & LOGOUT ----------
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
  
    // ---------- ADD NEW ENTRY ----------
    async function addNewEntry(entry) {
      currentEntries.push(entry);
      mappedEntries = mapEntries(currentEntries);
      applyFiltersAndSort();
      await saveEntryToFirestore(entry);
    }
  
    // ---------- CSV DOWNLOAD ----------
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
  
    // NAV TABS -> Configuration redirect (keeps your robust fallback logic)
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const clicked = e.currentTarget || e.target;
        const label = (clicked.textContent || clicked.innerText || '').trim();
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        clicked.classList.add('active');
        if (label === 'Configuration') {
          if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            try { chrome.tabs.create({ url: chrome.runtime.getURL('options.html'), active: true }); }
            catch (err) { if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage(); else window.location.href = 'options.html'; }
          } else {
            const rel = 'options.html'; const absRoot = window.location.origin + '/options.html';
            fetch(rel, { method:'HEAD' }).then(resp => { if (resp.ok) window.location.href = rel; else fetch(absRoot,{method:'HEAD'}).then(a => { if (a.ok) window.location.href = absRoot; else window.location.href = rel; }).catch(()=>window.location.href=rel); }).catch(()=>window.location.href=rel);
          }
          setTimeout(()=>{ document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active')); const first = document.querySelector('.nav-tab'); if (first) first.classList.add('active'); },100);
        }
      });
    });
  
    // Initial setup
    setupTableInteractions();
    loadProfile();
    subscribeToData();
  
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.onChanged.addListener((changes, ns) => { if (ns === 'local' && changes.kosh_auth) loadProfile(); });
    }
  });