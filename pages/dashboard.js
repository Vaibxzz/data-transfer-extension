// dashboard.js (final with modern sort emojis ⇅, ▲, ▼)
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

  // --- Elements ---
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
        }
        resolve(out);
      }
    });
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    if (typeof value === "number") return new Date(value);
    if (typeof value === "string") {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  function formatDateLocal(d) {
    if (!d) return "Invalid Date";
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).replace(/,/g, "");
  }

  function mapEntries(rawEntries) {
    return (rawEntries || []).map((e) => {
      const contact = e.contact || e.name || "";
      const parts = contact.split(" ").filter(Boolean);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";
      const rawTimestamp = normalizeTimestamp(e.timestamp ?? e.processTime);
      const processTime = rawTimestamp ? formatDateLocal(rawTimestamp) : "Invalid Date";
      return {
        firstName,
        lastName,
        country: e.country || "Unknown",
        processTime,
        rawTimestamp,
        _orig: e,
      };
    });
  }

  // --- Sort indicators ---
  function updateSortIndicators() {
    document.querySelectorAll(".sort-indicator").forEach((ind) => (ind.textContent = "⇅"));
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
    let all = [...mappedEntries];

    // Apply filters
    all = all.filter((item) => {
      for (const [column, term] of Object.entries(columnFilters)) {
        let val = String(item[column] ?? "").toLowerCase();
        if (!val.includes(term)) return false;
      }
      return true;
    });

    // Apply date range
    if (selectedRange.start && selectedRange.end) {
      const start = new Date(selectedRange.start).getTime();
      const end = new Date(selectedRange.end).getTime();
      all = all.filter(
        (item) =>
          item.rawTimestamp &&
          item.rawTimestamp.getTime() >= start &&
          item.rawTimestamp.getTime() <= end
      );
    }

    // Sort
    if (sortConfig.column) {
      const col = sortConfig.column;
      all.sort((a, b) => {
        if (col === "processTime") {
          const aTime = a.rawTimestamp ? a.rawTimestamp.getTime() : -Infinity;
          const bTime = b.rawTimestamp ? b.rawTimestamp.getTime() : -Infinity;
          return sortConfig.direction === "asc" ? aTime - bTime : bTime - aTime;
        }
        const aVal = String(a[col] ?? "").toLowerCase();
        const bVal = String(b[col] ?? "").toLowerCase();
        return sortConfig.direction === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      });
    }

    filteredEntries = all;
    renderFilteredData();
  }

  function renderFilteredData() {
    tableBody.innerHTML = "";
    if (!filteredEntries.length) {
      const row = document.createElement("tr");
      row.innerHTML =
        '<td colspan="4" style="text-align:center; color:#9ca3af;">No matching entries</td>';
      tableBody.appendChild(row);
    } else {
      filteredEntries.forEach((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${item.firstName}</td>
          <td>${item.lastName}</td>
          <td>${item.country}</td>
          <td>${item.processTime}</td>
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
    if (rejectedEntriesCard) rejectedEntriesCard.textContent = "0";
  }

  // --- CSV Export ---
  function downloadData() {
    const headers = ["First Name", "Last Name", "Country", "Process Time"];
    let csv = headers.join(",") + "\n";
    filteredEntries.forEach((entry) => {
      csv += `"${entry.firstName}","${entry.lastName}","${entry.country}","${entry.processTime}"\n`;
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

  // --- Init ---
  setupTableInteractions();
  updateSortIndicators();
  applyFiltersAndSort();

  function setupTableInteractions() {
    const headers = document.querySelectorAll("th[data-column]");
    headers.forEach((header) => {
      header.addEventListener("click", () => {
        handleSort(header.dataset.column);
      });
    });
  }
});
