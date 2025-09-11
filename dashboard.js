// Dashboard behavior: date filter integrated with process time, profile menu & logout, and Invalid Date fixes.
// Safe to replace your current dashboard.js with this file (keeps layout identical).

document.addEventListener('DOMContentLoaded', () => {
    console.log('Dashboard DOM loaded');

    // --- FIREBASE INITIALIZATION ---
    // Assumes Firebase scripts are included in HTML and firebase is available globally
    // Replace with your actual config
    const firebaseConfig = {
        apiKey: "YOUR_API_KEY",
        authDomain: "YOUR_AUTH_DOMAIN",
        projectId: "YOUR_PROJECT_ID",
        storageBucket: "YOUR_STORAGE_BUCKET",
        messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
        appId: "YOUR_APP_ID"
    };
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    // --- SAVE ENTRY TO FIRESTORE (PER USER) ---
    /**
     * Save an approved entry to Firestore with a timestamp and userId.
     * @param {Object} entry - The entry object to store.
     * @returns {Promise} Resolves when the entry is written.
     */
    async function saveEntryToFirestore(entry) {
        try {
            // Get userId from kosh_auth
            const res = await chromeStorageGet('kosh_auth');
            const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
            const userId = auth && auth.user && auth.user.id ? auth.user.id : null;
            if (!userId) {
                console.error("[Firestore] Cannot save entry: userId missing.");
                return;
            }
            // Add a timestamp field (milliseconds since epoch) and userId
            const timestamp = Date.now();
            const entryWithMeta = { ...entry, timestamp, userId };
            await db.collection("approvedEntries").add(entryWithMeta);
            console.log("[Firestore] Entry saved to approvedEntries with timestamp and userId.");
        } catch (err) {
            console.error("[Firestore] Error saving entry:", err);
        }
    }

    // --- AUTO-DELETION PREFERENCE LOGIC ---
    // Retention preference in days (default: 30)
    let userPreference = 30;
    const RETENTION_STORAGE_KEY = 'approvedEntriesRetentionDays';
    // Read preference from localStorage on startup
    const storedPref = localStorage.getItem(RETENTION_STORAGE_KEY);
    if (storedPref && !isNaN(Number(storedPref))) {
        userPreference = Number(storedPref);
    }

    // Update preference and persist to localStorage
    function setRetentionPreference(days) {
        if (!isNaN(Number(days)) && Number(days) > 0) {
            userPreference = Number(days);
            localStorage.setItem(RETENTION_STORAGE_KEY, String(userPreference));
        }
    }

    // Cleanup function to delete old data from Firestore (PER USER)
    async function cleanupOldData() {
        try {
            // Get userId from kosh_auth
            const res = await chromeStorageGet('kosh_auth');
            const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
            const userId = auth && auth.user && auth.user.id ? auth.user.id : null;
            if (!userId) {
                console.error("[Auto-Delete] Cannot cleanup: userId missing.");
                return;
            }
            const now = Date.now();
            const cutoff = now - userPreference * 24 * 60 * 60 * 1000;
            // Query all approvedEntries for this user
            const snapshot = await db.collection("approvedEntries").where("userId", "==", userId).get();
            const batch = db.batch();
            let deleteCount = 0;
            snapshot.forEach(doc => {
                // Try to find the timestamp field (timestamp, processTime, or time)
                const data = doc.data();
                let ts = null;
                if (data.timestamp !== undefined && data.timestamp !== null) ts = data.timestamp;
                else if (data.processTime !== undefined && data.processTime !== null) ts = data.processTime;
                else if (data.time !== undefined && data.time !== null) ts = data.time;
                // Normalize to ms
                let tsMs = null;
                if (typeof ts === "number") tsMs = ts;
                else if (typeof ts === "string" && /^\d+$/.test(ts)) {
                    tsMs = ts.length === 10 ? parseInt(ts) * 1000 : parseInt(ts);
                } else if (typeof ts === "string") {
                    const d = new Date(ts);
                    if (!isNaN(d.getTime())) tsMs = d.getTime();
                }
                if (tsMs !== null && tsMs < cutoff) {
                    batch.delete(doc.ref);
                    deleteCount++;
                }
            });
            if (deleteCount > 0) {
                await batch.commit();
                console.log(`[Auto-Delete] Deleted ${deleteCount} entries older than ${userPreference} days for user ${userId}`);
            }
        } catch (err) {
            console.error('[Auto-Delete] Error during cleanupOldData:', err);
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
    const profileWrapper = document.getElementById('profile-wrapper');

    // internal state
    let currentEntries = [];        // raw from storage
    let mappedEntries = [];         // normalized entries used for filtering/sorting
    let filteredEntries = [];       // after filters/sort
    let sortConfig = { column: null, direction: 'asc' };
    let columnFilters = {};
    let activeSearchColumn = null;
    let selectedRange = { start: null, end: null }; // Date objects

    // ---------- Utilities ----------
    function chromeStorageGet(keys) {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                chrome.storage.local.get(keys, resolve);
            } else {
                // fallback: try localStorage
                const out = {};
                if (Array.isArray(keys)) {
                    keys.forEach(k => { out[k] = JSON.parse(localStorage.getItem(k) || 'null'); });
                } else if (typeof keys === 'string') {
                    out[keys] = JSON.parse(localStorage.getItem(keys) || 'null');
                } else {
                    Object.keys(keys || {}).forEach(k => { out[k] = JSON.parse(localStorage.getItem(k) || 'null'); });
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
                if (Array.isArray(keys)) {
                    keys.forEach(k => localStorage.removeItem(k));
                } else {
                    localStorage.removeItem(keys);
                }
                resolve();
            }
        });
    }

    function normalizeTimestamp(value) {
        if (value === undefined || value === null || value === '') return null;
        // If numeric (string or number)
        if (typeof value === 'number' && !isNaN(value)) {
            const d = new Date(value);
            return isNaN(d.getTime()) ? null : d;
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            // pure digits -> treat as epoch millis or seconds
            if (/^\d+$/.test(trimmed)) {
                // if length is 10 -> seconds, convert to ms
                if (trimmed.length === 10) {
                    const ms = parseInt(trimmed, 10) * 1000;
                    const d = new Date(ms);
                    return isNaN(d.getTime()) ? null : d;
                } else {
                    // treat as ms
                    const d = new Date(parseInt(trimmed, 10));
                    return isNaN(d.getTime()) ? null : d;
                }
            }
            // try ISO / natural parsing
            const d = new Date(trimmed);
            if (!isNaN(d.getTime())) return d;

            // Try common format d-m-yyyy or dd-mm-yyyy
            const match = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
            if (match) {
                const day = parseInt(match[1], 10);
                const month = parseInt(match[2], 10) - 1;
                let year = parseInt(match[3], 10);
                if (year < 100) year += 2000;
                const dd = new Date(year, month, day);
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
        } catch (e) {
            return d.toString();
        }
    }

    // Map raw approved entries (from storage) into objects used by filtering/rendering
    function mapEntries(rawEntries) {
        const mapped = (rawEntries || []).map(e => {
            // e may have `contact` or `name`, and `country`, and `timestamp` or `processTime`
            const contact = e.contact || e.name || '';
            const nameParts = contact.split(' ').filter(Boolean);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';
            const rawTimestamp = normalizeTimestamp(e.timestamp ?? e.processTime ?? e.time ?? null);
            const processTime = rawTimestamp ? formatDateLocal(rawTimestamp) : 'Invalid Date';
            return {
                firstName,
                lastName,
                country: e.country || e.location || 'Unknown',
                processTime,
                rawTimestamp, // Date | null
                _orig: e
            };
        });
        return mapped;
    }

    // ---------- TABLE SEARCH/SORT ----------
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
                searchInput.addEventListener('input', (ev) => {
                    ev.stopPropagation();
                    handleColumnSearch(header.dataset.column, ev.target.value);
                });
                searchInput.addEventListener('click', (ev) => ev.stopPropagation());
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('th')) closeAllSearchContainers();
        });
    }

    function toggleSearchContainer(header) {
        const searchContainer = header.querySelector('.column-search-container');
        const column = header.dataset.column;
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
        const searchInput = searchContainer.querySelector('.column-search');
        setTimeout(() => searchInput.focus(), 50);
    }

    function closeAllSearchContainers() {
        document.querySelectorAll('.column-search-container.active').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('th.search-active').forEach(h => h.classList.remove('search-active'));
        activeSearchColumn = null;
    }

    function handleSort(column) {
        if (sortConfig.column === column) {
            sortConfig.direction = (sortConfig.direction === 'asc') ? 'desc' : 'asc';
        } else {
            sortConfig.column = column;
            sortConfig.direction = 'asc';
        }
        updateSortIndicators();
        applyFiltersAndSort();
    }

    function updateSortIndicators() {
        document.querySelectorAll('.sort-indicator').forEach(ind => ind.textContent = '⇅');
        if (sortConfig.column) {
            const el = document.querySelector(`th[data-column="${sortConfig.column}"] .sort-indicator`);
            if (el) el.textContent = sortConfig.direction === 'asc' ? '↑' : '↓';
        }
    }

    function handleColumnSearch(column, searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') delete columnFilters[column];
        else columnFilters[column] = searchTerm.toLowerCase();
        applyFiltersAndSort();
    }

    // ---------- FILTER / SORT / RENDER ----------
    function applyFiltersAndSort() {
        // combine static (sample) entries and real mappedEntries
        const staticEntries = [
            { firstName: 'Maria', lastName: 'Anders', country: 'Germany', processTime: 'Invalid Date', rawTimestamp: null },
            { firstName: 'Maria', lastName: 'Anders', country: 'Germany', processTime: 'Invalid Date', rawTimestamp: null }
        ];
        let all = [...staticEntries, ...mappedEntries];

        // apply column text filters
        all = all.filter(item => {
            for (const [column, term] of Object.entries(columnFilters)) {
                let val = String(item[column] ?? '').toLowerCase();
                if (!val.includes(term)) return false;
            }
            return true;
        });

        // apply date range filter if selectedRange has both start & end
        if (selectedRange.start && selectedRange.end) {
            const start = new Date(selectedRange.start);
            start.setHours(0,0,0,0);
            const end = new Date(selectedRange.end);
            end.setHours(23,59,59,999);
            all = all.filter(item => {
                if (!item.rawTimestamp) return false; // exclude items with no timestamp when date filter is active
                return item.rawTimestamp.getTime() >= start.getTime() && item.rawTimestamp.getTime() <= end.getTime();
            });
        }

        // sorting
        if (sortConfig.column) {
            const col = sortConfig.column;
            all.sort((a,b) => {
                // for processTime use rawTimestamp numeric comparison where possible
                if (col === 'processTime') {
                    const aTime = a.rawTimestamp ? a.rawTimestamp.getTime() : -Infinity;
                    const bTime = b.rawTimestamp ? b.rawTimestamp.getTime() : -Infinity;
                    if (aTime < bTime) return sortConfig.direction === 'asc' ? -1 : 1;
                    if (aTime > bTime) return sortConfig.direction === 'asc' ? 1 : -1;
                    return 0;
                } else {
                    const aVal = String(a[col] ?? '').toLowerCase();
                    const bVal = String(b[col] ?? '').toLowerCase();
                    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                    return 0;
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
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // ---------- DROPDOWN (unchanged behavior) ----------
    if (dropdownToggle && dropdownMenu) {
        dropdownToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });
        document.addEventListener('click', () => dropdownMenu.classList.remove('show'));
        dropdownMenu.addEventListener('click', (e) => e.stopPropagation());
        dropdownMenu.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.addEventListener('change', updateSelectedCategories));
    }
    function updateSelectedCategories() {
        const selected = [];
        dropdownMenu.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
            selected.push(cb.nextElementSibling.textContent);
        });
        const selectedCategory = document.getElementById('selected-category');
        if (selectedCategory) {
            if (selected.length === 0) selectedCategory.textContent = 'Select categories';
            else if (selected.length === 1) selectedCategory.textContent = selected[0];
            else selectedCategory.textContent = `${selected.length} selected`;
        }
    }

    // ---------- DATE PICKER (Flatpickr) ----------
    if (datePickerDiv && typeof flatpickr !== 'undefined' && dateInput) {
        const initialText = dateRange.textContent.trim();
        // try to parse initial text for defaultDate:
        let defaultDates = null;
        const parts = initialText.split('-').map(s => s.trim());
        if (parts.length === 2) {
            // expected "dd-mm-yyyy - dd-mm-yyyy" maybe
            const d1 = normalizeTimestamp(parts[0]);
            const d2 = normalizeTimestamp(parts[1]);
            if (d1 && d2) defaultDates = [d1, d2];
        }
        const fp = flatpickr(dateInput, {
            mode: "range",
            dateFormat: "d-m-Y",
            defaultDate: defaultDates || undefined,
            clickOpens: false,
            onChange: function(selectedDates, dateStr, instance) {
                if (selectedDates.length === 2) {
                    selectedRange.start = selectedDates[0];
                    selectedRange.end = selectedDates[1];
                    dateRange.textContent = `${instance.formatDate(selectedDates[0], "d-m-Y")} - ${instance.formatDate(selectedDates[1], "d-m-Y")}`;
                } else if (selectedDates.length === 1) {
                    selectedRange.start = selectedDates[0];
                    selectedRange.end = null;
                    dateRange.textContent = instance.formatDate(selectedDates[0], "d-m-Y");
                } else {
                    selectedRange.start = null;
                    selectedRange.end = null;
                    dateRange.textContent = 'All dates';
                }
                applyFiltersAndSort();
            },
            onReady: function(selectedDates, dateStr, instance) {
                if (selectedDates.length === 2) {
                    dateRange.textContent = `${instance.formatDate(selectedDates[0], "d-m-Y")} - ${instance.formatDate(selectedDates[1], "d-m-Y")}`;
                    selectedRange.start = selectedDates[0];
                    selectedRange.end = selectedDates[1];
                }
            }
        });

        datePickerDiv.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fp.open();
        });
        datePickerDiv.style.cursor = 'pointer';
    }

    // ---------- PROFILE MENU & LOGOUT ----------
    async function loadProfile() {
        const res = await chromeStorageGet('kosh_auth');
        const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
        if (auth && auth.user) {
            const user = auth.user;
            profileNameEl.textContent = user.name || user.email || 'User';
            profileEmailEl.textContent = user.email || '';
            // avatar initial
            const initial = (user.name || user.email || 'S')[0].toUpperCase();
            profileAvatarEl.textContent = initial;
            userAvatarEl.textContent = initial;
        } else {
            profileNameEl.textContent = 'Guest';
            profileEmailEl.textContent = 'Not signed in';
            profileAvatarEl.textContent = 'S';
            userAvatarEl.textContent = 'S';
        }
    }

    // toggle menu
    if (userAvatarEl && profileMenuEl) {
        userAvatarEl.addEventListener('click', (e) => {
            e.stopPropagation();
            profileMenuEl.classList.toggle('show');
            profileMenuEl.setAttribute('aria-hidden', profileMenuEl.classList.contains('show') ? 'false' : 'true');
        });
        // close on outside click
        document.addEventListener('click', () => {
            profileMenuEl.classList.remove('show');
            profileMenuEl.setAttribute('aria-hidden', 'true');
        });
        // prevent closing when clicking inside
        profileMenuEl.addEventListener('click', (e) => e.stopPropagation());
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', async (e) => {
            e.preventDefault();
            // remove stored auth
            await chromeStorageRemove('kosh_auth');
            try { localStorage.removeItem('kosh_auth'); } catch (e) {}
            // open options/auth page so user can sign-in again
            if (typeof chrome !== 'undefined' && chrome.tabs) {
                chrome.tabs.create({ url: chrome.runtime.getURL('auth.html'), active: true });
            } else {
                // fallback
                window.location.href = 'auth.html';
            }
            // close current window if it is an extension page
            try { window.close(); } catch (e) {}
        });
    }

    // ---------- ADD NEW ENTRY (Firestore-first) ----------
    /**
     * Add a new dashboard entry: push to currentEntries, update mappedEntries, filter/sort, and store in Firestore (PER USER).
     * @param {Object} entry
     */
    async function addNewEntry(entry) {
        currentEntries.push(entry);
        mappedEntries = mapEntries(currentEntries);
        applyFiltersAndSort();
        await saveEntryToFirestore(entry);
    }

    // ---------- LOAD / RENDER DATA ----------
    // Subscribe to Firestore changes (PER USER)
    async function subscribeToData() {
        // Get userId from kosh_auth
        const res = await chromeStorageGet('kosh_auth');
        const auth = res && res.kosh_auth ? res.kosh_auth : (localStorage.getItem('kosh_auth') ? JSON.parse(localStorage.getItem('kosh_auth')) : null);
        const userId = auth && auth.user && auth.user.id ? auth.user.id : null;
        if (!userId) {
            console.error("Cannot subscribe to data: userId missing.");
            mappedEntries = [];
            applyFiltersAndSort();
            return;
        }
        db.collection("approvedEntries").where("userId", "==", userId)
            .onSnapshot((snapshot) => {
                const entries = [];
                snapshot.forEach(doc => {
                    entries.push(doc.data());
                });
                currentEntries = entries;
                mappedEntries = mapEntries(currentEntries);
                applyFiltersAndSort();
            }, (err) => {
                console.error("Firestore onSnapshot error", err);
                mappedEntries = [];
                applyFiltersAndSort();
            });
        // After subscribing, set interval to cleanup old data once a day
        setTimeout(cleanupOldData, 2000); // Initial cleanup after loading (2s delay)
        setInterval(cleanupOldData, 24 * 60 * 60 * 1000); // Every 24 hours
    }

    // ---------- CSV DOWNLOAD ----------
    function downloadData() {
        const headers = ['First Name', 'Last Name', 'Country', 'Process Time'];
        let csvContent = headers.join(',') + '\n';
        filteredEntries.forEach(entry => {
            csvContent += `"${entry.firstName || ''}","${entry.lastName || ''}","${entry.country || ''}","${entry.processTime || ''}"\n`;
        });
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `reconciliation-data-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        window.URL.revokeObjectURL(url);
    }
    if (downloadBtn) downloadBtn.addEventListener('click', downloadData);

    // NAV TABS behavior (unchanged)
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            if (e.target.textContent.trim() === 'Configuration') {
                if (typeof chrome !== 'undefined' && chrome.tabs) {
                    chrome.tabs.create({ url: chrome.runtime.getURL('options.html'), active: true });
                } else {
                    window.location.href = 'options.html';
                }
                setTimeout(() => {
                    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
                    document.querySelector('.nav-tab').classList.add('active');
                }, 100);
            }
        });
    });

    // Initial setup
    setupTableInteractions();
    loadProfile();
    // loadData(); // replaced by subscribeToData
    subscribeToData();

    // No polling or chrome.storage.onChanged for data anymore
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.kosh_auth) {
                loadProfile();
            }
        });
    }
});