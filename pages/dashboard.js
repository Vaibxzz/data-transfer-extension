// dashboard.js (checked + small fixes)
// Keeps your structure and minimal behavior; uses neutral '↕' + '↑' / '↓' for sort indicators.

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

(async () => {
  try {
    await waitForFirebaseReady();
  } catch (e) {
    console.error("Firebase SDK not loaded yet — dashboard will wait.", e);
    const root = document.getElementById("dashboard-root");
    if (root) root.innerText = "Waiting for Firebase…";
  }
})();

document.addEventListener("DOMContentLoaded", () => {
  console.log("Dashboard DOM loaded");

  // --- Firebase init (auth only) ---
  const firebaseConfig = {
    apiKey: "AIzaSyAddUryOENzoRqCCaIO_5GPduBsYGI512k",
    authDomain: "nimble-falcon-38ada.firebaseapp.com",
    projectId: "nimble-falcon-38ada",
    storageBucket: "nimble-falcon-38ada.firebasestorage.app",
    messagingSenderId: "1094058263345",
    appId: "1:1094058263345:web:6ce5920eb3bca28b576610",
  };
  if (typeof firebase !== "undefined" && !firebase.apps.length) {
    try {
      firebase.initializeApp(firebaseConfig);
    } catch (e) {
      console.warn("Firebase init warning:", e);
    }
  }

  // --- State ---
  let currentEntries = [];
  let mappedEntries = [];
  let filteredEntries = [];
  let sortConfig = { column: null, direction: "asc" };
  let columnFilters = {};
  let activeSearchColumn = null;
  let selectedRange = { start: null, end: null };
  let subscriptionStarted = false;

  // --- Elements (guarded) ---
  const tableBody = document.getElementById("entries-table-body");
  const totalEntriesCard = document.getElementById("total-entries");
  const processedEntriesCard = document.getElementById("processed-entries");
  const rejectedEntriesCard = document.getElementById("rejected-entries");
  const downloadBtn = document.getElementById("download-btn");
  const dropdownToggle = document.getElementById("dropdown-toggle");
  const dropdownMenu = document.getElementById("dropdown-menu");
  const datePickerDiv = document.getElementById("date-picker");
  const dateRange = document.getElementById("date-range");
  const dateInput = document.getElementById("date-input");
  const userAvatarEl = document.getElementById("user-avatar");
  const profileMenuEl = document.getElementById("profile-menu");
  const profileNameEl = document.getElementById("profile-name");
  const profileEmailEl = document.getElementById("profile-email");
  const profileAvatarEl = document.getElementById("profile-avatar");
  const btnLogout = document.getElementById("btn-logout");

  // --- Helpers ---
  function chromeStorageGet(keys) {
    return new Promise((resolve) => {
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(keys, resolve);
      } else {
        const out = {};
        if (Array.isArray(keys)) {
          keys.forEach((k) => {
            try {
              out[k] = JSON.parse(localStorage.getItem(k));
            } catch (e) {
              out[k] = localStorage.getItem(k);
            }
          });
        } else if (typeof keys === "string") {
          try {
            out[keys] = JSON.parse(localStorage.getItem(keys));
          } catch (e) {
            out[keys] = localStorage.getItem(keys);
          }
        } else if (typeof keys === "object" && keys !== null) {
          Object.keys(keys).forEach(k => {
            try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e){ out[k] = localStorage.getItem(k); }
            if (out[k] === null || out[k] === undefined) out[k] = keys[k];
          });
        }
        resolve(out);
      }
    });
  }

  function normalizeTimestamp(value) {
    if (value === undefined || value === null || value === '') return null;
    // numbers: detect seconds (10-digit) vs ms (13-digit)
    if (typeof value === 'number' && !isNaN(value)) {
      // if value looks like seconds (<= 1e11) convert to ms
      if (value < 1e11) return new Date(value * 1000);
      return new Date(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) {
        // numeric string — treat 10-digit as seconds
        if (trimmed.length === 10) return new Date(parseInt(trimmed, 10) * 1000);
        return new Date(parseInt(trimmed, 10));
      }
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) return d;
      // fallback pattern dd-mm-yyyy or dd/mm/yyyy
      const match = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
      if (match) {
        const day = parseInt(match[1], 10), month = parseInt(match[2], 10) - 1, year = parseInt(match[3], 10);
        const y = year < 100 ? year + 2000 : year;
        const dd = new Date(y, month, day);
        return isNaN(dd.getTime()) ? null : dd;
      }
    }
    return null;
  }

  function formatDateLocal(d) {
    if (!d) return "Invalid Date";
    try {
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).replace(/,/g, "");
    } catch (e) { return d.toString(); }
  }

  function mapEntries(rawEntries) {
    return (rawEntries || []).map((e) => {
      const contact = e.contact || e.name || `${e.firstName || ''} ${e.lastName || ''}`.trim() || '';
      const parts = contact.split(" ").filter(Boolean);
      const firstName = parts[0] || (e.firstName || '');
      const lastName = parts.slice(1).join(" ") || (e.lastName || '');
      const rawTimestamp = normalizeTimestamp(e.timestamp ?? e.processTime ?? e.time ?? null);
      const processTime = rawTimestamp ? formatDateLocal(rawTimestamp) : "Invalid Date";
      // determine status if present
      const status = (e.status || e._status || (e.approved ? 'processed' : (e.rejected ? 'rejected' : 'processed')) || '').toString().toLowerCase();
      return {
        firstName,
        lastName,
        country: e.country || e.location || "Unknown",
        processTime,
        rawTimestamp,
        status,
        _orig: e,
      };
    });
  }

  // --- Sort indicators (neutral: ↕ ; asc: ↑ ; desc: ↓ ) ---
  function updateSortIndicators() {
    document.querySelectorAll(".sort-indicator").forEach((ind) => {
      if (ind) ind.textContent = "↕";
    });
    if (sortConfig.column) {
      const el = document.querySelector(`th[data-column="${sortConfig.column}"] .sort-indicator`);
      if (el) el.textContent = sortConfig.direction === "asc" ? "↑" : "↓";
    }
  }

  // --- Table filters & sort ---
  function handleSort(column) {
    if (sortConfig.column === column) {
      sortConfig.direction = sortConfig.direction === "asc" ? "desc" : "asc";
    } else {
      sortConfig.column = column;
      sortConfig.direction = "asc";
    }
    updateSortIndicators();
    applyFiltersAndSort();
  }

  function applyFiltersAndSort() {
    // fall back to empty array
    let all = Array.isArray(mappedEntries) ? [...mappedEntries] : [];

    // column filters
    all = all.filter((item) => {
      for (const [column, term] of Object.entries(columnFilters)) {
        const val = String(item[column] ?? '').toLowerCase();
        if (!val.includes(term)) return false;
      }
      return true;
    });

    // date range
    if (selectedRange.start && selectedRange.end) {
      const start = new Date(selectedRange.start); start.setHours(0,0,0,0);
      const end = new Date(selectedRange.end); end.setHours(23,59,59,999);
      all = all.filter(item => item.rawTimestamp && item.rawTimestamp.getTime() >= start.getTime() && item.rawTimestamp.getTime() <= end.getTime());
    }

    // sort
    if (sortConfig.column) {
      const col = sortConfig.column;
      all.sort((a, b) => {
        if (col === "processTime") {
          const aTime = a.rawTimestamp ? a.rawTimestamp.getTime() : -Infinity;
          const bTime = b.rawTimestamp ? b.rawTimestamp.getTime() : -Infinity;
          return sortConfig.direction === "asc" ? aTime - bTime : bTime - aTime;
        }
        const aVal = String(a[col] ?? '').toLowerCase();
        const bVal = String(b[col] ?? '').toLowerCase();
        return sortConfig.direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      });
    }

    filteredEntries = all;
    renderFilteredData();
  }

  function renderFilteredData() {
    if (!tableBody) return;
    tableBody.innerHTML = "";
    if (!filteredEntries || filteredEntries.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="4" style="text-align:center; color:#9ca3af;">No matching entries</td>';
      tableBody.appendChild(row);
      return;
    }
    filteredEntries.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHtml(item.firstName || '')}</td>
        <td>${escapeHtml(item.lastName || '')}</td>
        <td>${escapeHtml(item.country || '')}</td>
        <td>${escapeHtml(item.processTime || 'Invalid Date')}</td>
      `;
      tableBody.appendChild(row);
    });
    updateStats();
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function updateStats() {
    // derive stats from mappedEntries where possible
    const arr = Array.isArray(mappedEntries) ? mappedEntries : [];
    const total = arr.length;
    const processed = arr.filter(e => (e.status || '').toLowerCase() === 'processed' || (e._orig && (e._orig.approved || e._orig._approved))).length;
    const rejected = arr.filter(e => (e.status || '').toLowerCase() === 'rejected' || (e._orig && (e._orig.rejected || e._orig._rejected))).length;

    if (totalEntriesCard) totalEntriesCard.textContent = String(total);
    if (processedEntriesCard) processedEntriesCard.textContent = String(processed);
    if (rejectedEntriesCard) rejectedEntriesCard.textContent = String(rejected);

    // visually set active stat (if you want)
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active'));
    if (!sortConfig.column && totalEntriesCard) totalEntriesCard.parentElement && totalEntriesCard.parentElement.classList && totalEntriesCard.classList && document.getElementById('stat-total') && document.getElementById('stat-total').classList.add('active');
  }

  // --- CSV Export ---
  function downloadData() {
    const headers = ["First Name", "Last Name", "Country", "Process Time"];
    let csv = headers.join(",") + "\n";
    (filteredEntries || []).forEach((entry) => {
      csv += `"${(entry.firstName||'').replace(/"/g,'""')}","${(entry.lastName||'').replace(/"/g,'""')}","${(entry.country||'').replace(/"/g,'""')}","${(entry.processTime||'').replace(/"/g,'""')}"\n`;
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `data-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
  }
  if (downloadBtn) downloadBtn.addEventListener("click", downloadData);

  // --- Setup table header interactions (click to sort; does not break if search containers present) ---
  function setupTableInteractions() {
    const headers = document.querySelectorAll("th[data-column]");
    headers.forEach((header) => {
      header.addEventListener("click", (e) => {
        // if click inside column search input, ignore
        if (e.target && e.target.closest && e.target.closest('.column-search-container')) return;
        const col = header.getAttribute('data-column');
        if (col) handleSort(col);
      });

      // wire up column search input if present
      const searchInput = header.querySelector('.column-search');
      if (searchInput) {
        searchInput.addEventListener('input', (ev) => {
          const c = header.getAttribute('data-column');
          if (!c) return;
          const v = (ev.target.value || '').trim();
          if (!v) delete columnFilters[c];
          else columnFilters[c] = v.toLowerCase();
          applyFiltersAndSort();
        });
        // prevent header click when clicking input
        searchInput.addEventListener('click', ev => ev.stopPropagation());
      }
    });
    document.addEventListener('click', (e) => {
      // close any open column-search containers if clicked outside
      if (!e.target.closest('th')) {
        document.querySelectorAll('.column-search-container.active').forEach(c=>c.classList.remove('active'));
        document.querySelectorAll('th.search-active').forEach(h=>h.classList.remove('search-active'));
        activeSearchColumn = null;
      }
    });
  }

  // --- Minimal public function to set entries (call this after fetching from backend) ---
  // Accepts raw entries array (from backend) and refreshes table
  window.__KOSH__ = window.__KOSH__ || {};
  window.__KOSH__.setEntries = function(rawEntries) {
    currentEntries = Array.isArray(rawEntries) ? rawEntries : [];
    mappedEntries = mapEntries(currentEntries);
    applyFiltersAndSort();
  };

  // Initial setup
  setupTableInteractions();
  updateSortIndicators();
  applyFiltersAndSort();

}); // DOMContentLoaded end
