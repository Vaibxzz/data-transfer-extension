// background.js (MV3 service worker)
// Listens for action click or messages from UI, injects a scraper into the active tab,
// collects W3C-ish table data and stores it into chrome.storage for the UI page to display.

'use strict';

// -------------------- CONFIG --------------------
// -------------------- DYNAMIC CONFIG FROM options (chrome.storage.sync) --------------------
let cachedConfig = {
    backendEndpoint: '',
    authToken: '',
    allowedHostsSet: new Set()
  };
  
  // read config from storage (called on startup and when needed)
  async function loadConfigFromStorage() {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        chrome.storage.sync.get({ destinationUrl: '', sourceUrl: '', allowedHosts: [] }, (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('chrome.storage.sync.get error', chrome.runtime.lastError);
            // fallback to localStorage
            const dest = localStorage.getItem('destinationUrl') || '';
            const token = localStorage.getItem('authToken') || '';
            const allowed = (localStorage.getItem('allowedHosts') || '').split(',').map(s => s.trim()).filter(Boolean);
            cachedConfig.backendEndpoint = (dest || '').toString().trim();
            cachedConfig.authToken = (token || '').toString().trim();
            cachedConfig.allowedHostsSet = new Set(allowed.map(h => h.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase()));
            resolve(cachedConfig);
            return;
          }
          const endpoint = (items.destinationUrl || '').toString().trim();
          const token = (items.authToken || '').toString().trim();
          const allowedHostsArr = Array.isArray(items.allowedHosts) ? items.allowedHosts : (typeof items.allowedHosts === 'string' ? items.allowedHosts.split(',') : items.allowedHosts || []);
          const normalized = (allowedHostsArr || []).map(h => (h || '').toString().trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase()).filter(Boolean);
          cachedConfig.backendEndpoint = endpoint;
          cachedConfig.authToken = token;
          cachedConfig.allowedHostsSet = new Set(normalized);
          resolve(cachedConfig);
        });
      } else {
        // fallback for local dev / file:// options page
        const dest = localStorage.getItem('destinationUrl') || '';
        const token = localStorage.getItem('authToken') || '';
        const allowed = (localStorage.getItem('allowedHosts') || '').split(',').map(s => s.trim()).filter(Boolean);
        cachedConfig.backendEndpoint = dest;
        cachedConfig.authToken = token;
        cachedConfig.allowedHostsSet = new Set(allowed.map(h => h.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase()));
        resolve(cachedConfig);
      }
    });
  }
  
  // initially load config
  loadConfigFromStorage().catch(() => {});
  // update cache live when options change
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        if (changes.destinationUrl || changes.authToken || changes.allowedHosts) {
          loadConfigFromStorage().catch(() => {});
        }
      }
    });
  }

// -------------------- UTIL: host normalization & checks --------------------
function normalizeHostFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    } catch (e) {
      // if caller passed a raw host like "example.com", handle that
      try {
        return (url || '').toString().replace(/^www\./i, '').toLowerCase();
      } catch (e2) {
        return '';
      }
    }
  }
  
  function isHostAllowed(urlOrHost) {
    if (!urlOrHost) return false;
  
    // if chrome.storage returned an object mistakenly, handle it
    if (typeof urlOrHost === 'object') {
      // object passed by mistake — try to extract url property
      if (urlOrHost.url) urlOrHost = urlOrHost.url;
      else return false;
    }
  
    const host = urlOrHost.includes('://') ? normalizeHostFromUrl(urlOrHost) : (urlOrHost || '').toString().replace(/^www\./i, '').toLowerCase();
    if (!host) return false;
  
    // if no allowed hosts configured, allow by default (dev) OR deny by default (prod)
    if (!cachedConfig.allowedHostsSet || cachedConfig.allowedHostsSet.size === 0) {
      // CHANGE this depending on your preference:
      // return true; // permissive (dev)
      return false; // strict (prod)
    }
  
    return cachedConfig.allowedHostsSet.has(host);
  }

// -------------------- SAFE EXECUTION WRAPPER --------------------
/**
 * safeExecuteOnTab(tabId, fnOrFiles)
 * - tabId: numeric tab id
 * - fnOrFiles: { func: someFunction }  OR { files: ['file.js'] }
 *
 * Returns result array from chrome.scripting.executeScript on success, or null on failure/abort.
 */
async function safeExecuteOnTab(tabId, fnOrFiles) {
    try {
      if (!tabId) {
        console.warn('safeExecuteOnTab: invalid tabId', tabId);
        return null;
      }
  
      // get the tab URL reliably
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (err) {
        console.warn('safeExecuteOnTab: could not get tab', tabId, err);
        return null;
      }
  
      const url = tab && tab.url ? tab.url : '';
      if (!url) {
        console.warn('Host validation failed: tab URL empty — aborting executeScript.', { tabId });
        return null;
      }
  
      const host = normalizeHostFromUrl(url);
      if (!host) {
        console.warn('Host validation failed: could not parse host — aborting', { url });
        return null;
      }
  
      // <-- use isHostAllowed (reads cachedConfig) instead of missing ALLOWED_HOSTS
      if (!isHostAllowed(host)) {
        console.warn('Host is not supported or not in whitelist — aborting executeScript.', host);
        return null;
      }
  
      // allowed -> call the original execution
      const execArgs = {
        target: { tabId },
        ...fnOrFiles
      };
  
      const results = await chrome.scripting.executeScript(execArgs);
      return results;
    } catch (err) {
      console.error('safeExecuteOnTab error', err);
      return null;
    }
  }

// -------------------- SCRAPER FUNCTION (to be executed in page context) --------------------
// Note: keep this function serializable (no closures). This mirrors your original inline func.
function pageScraper() {
  // Find the first table that looks like a W3C table or a data table
  const table =
    document.querySelector('table.w3-table') ||
    document.querySelector('table[data-w3c]') ||
    document.querySelector('table') ||
    null;

  if (!table) {
    return { ok: false, error: 'No table element found on the page' };
  }

  // Extract headers - prefer thead th, else first row th/td
  let headers = [];
  const thead = table.querySelector('thead');
  if (thead) {
    headers = Array.from(thead.querySelectorAll('th')).map(t => t.textContent.trim());
  }
  if (!headers.length) {
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      headers = Array.from(firstRow.children).map((c, idx) => {
        const txt = c.textContent.trim();
        return txt || `col${idx + 1}`;
      });
      // don't mutate DOM in a way that breaks pages — we won't remove nodes now
    }
  }

  // Build rows: iterate over tr elements, skip header row if it's thead or first <tr> when it had ths
  const rows = [];
  const trs = Array.from(table.querySelectorAll('tr'));
  for (const tr of trs) {
    // skip rows with no td/th children
    const cells = Array.from(tr.children).filter(n => /td|th/i.test(n.tagName));
    if (!cells.length) continue;

    // If header-like row (all th), skip it
    const allTh = cells.every(c => c.tagName.toLowerCase() === 'th');
    if (allTh) continue;

    const row = {};
    cells.forEach((cell, i) => {
      const key = headers[i] || `col${i + 1}`;
      row[key] = cell.innerText.trim();
    });

    // only add non-empty rows
    if (Object.keys(row).length) rows.push(row);
  }

  return { ok: true, headers, rows, rowCount: rows.length };
}

// -------------------- Helper: run scraper in tab (uses safeExecuteOnTab) --------------------
async function runScraperInTab(tabId) {
  try {
    // Use the safe wrapper to ensure host is allowed
    const results = await safeExecuteOnTab(tabId, { func: pageScraper });
    if (!results) {
      return { ok: false, error: 'Execution aborted or failed (host not allowed or exec error)' };
    }

    // chrome.scripting.executeScript returns an array of result objects; the pageScript's returned object is in results[0].result
    const entry = results[0];
    if (!entry || typeof entry.result === 'undefined') {
      return { ok: false, error: 'No result from page script' };
    }
    return entry.result;
  } catch (err) {
    console.error('runScraperInTab error', err);
    return { ok: false, error: String(err) };
  }
}

// -------------------- Save results to chrome.storage and notify UI --------------------
// inside background.js – modify handleScrape to also send payload to your hosted backend
async function handleScrape(tabId) {
    const res = await runScraperInTab(tabId);
    const time = new Date().toISOString();
    const payload = { fetchedAt: time, result: res };
  
    try {
      await chrome.storage.local.set({ lastScrape: payload });
    } catch (e) {
      console.warn('Failed to store lastScrape', e);
    }
  
    try {
      chrome.runtime.sendMessage({ type: 'SCRAPE_COMPLETE', payload });
    } catch (e) {
      console.warn('Failed to send SCRAPE_COMPLETE message', e);
    }
  
    // ---- DYNAMIC: send payload to backend using options saved by the user ----
    await loadConfigFromStorage(); // refresh cache
  
    const BACKEND_ENDPOINT = (cachedConfig.backendEndpoint || '').toString().trim();
    const AUTH_TOKEN = (cachedConfig.authToken || '').toString().trim();
  
    if (!BACKEND_ENDPOINT) {
      console.warn('No destination URL configured in Options — skipping post to server.');
      return payload;
    }


  // Basic validation: require HTTPS
  if (!/^https:\/\//i.test(BACKEND_ENDPOINT)) {
    console.warn('Configured destination is not HTTPS — skipping post for safety.', BACKEND_ENDPOINT);
    return payload;
  }

  async function postToServer(attempt = 1) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (AUTH_TOKEN) headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;

      const resp = await fetch(BACKEND_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Server responded ${resp.status} ${text}`);
      }

      console.log('Scrape posted to server successfully to', BACKEND_ENDPOINT);
      return true;
    } catch (err) {
      console.warn(`Attempt ${attempt} - failed to post scrape to ${BACKEND_ENDPOINT}:`, err);
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        return postToServer(attempt + 1);
      }
      return false;
    }
  }

  // fire-and-forget; await it if you want blocking behaviour
  postToServer().catch(e => console.error('postToServer fatal error', e));

  return payload;
}
// -------------------- Respond to toolbar action (click) --------------------
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab || !tab.id) {
      console.warn('action.onClicked: no tab available');
      return;
    }

    // Ensure host allowed before proceeding
    const url = tab.url || '';
    if (!isHostAllowed(url)) {
      console.warn('action.onClicked: host not allowed for scraping', tab.url);
      return;
    }

    const info = await handleScrape(tab.id);

    // open the background UI page in a new tab to show results (optional)
    const urlToOpen = chrome.runtime.getURL('background.html');
    chrome.tabs.create({ url: urlToOpen });
  } catch (e) {
    console.error('action.onClicked handler error', e);
  }
});

// -------------------- Respond to messages from UI (background.html) --------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'SCRAPE_NOW') {
    (async () => {
      try {
        // if sender.tab present, target that; else use active tab
        let targetTabId = (sender && sender.tab && sender.tab.id) || null;
        if (!targetTabId) {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs && tabs[0]) targetTabId = tabs[0].id;
        }
        if (!targetTabId) {
          sendResponse({ ok: false, error: 'No active tab to scrape' });
          return;
        }

        // Ensure host allowed before proceeding
        let tabInfo;
        try {
          tabInfo = await chrome.tabs.get(targetTabId);
        } catch (err) {
          sendResponse({ ok: false, error: 'Unable to fetch tab info' });
          return;
        }

        if (!isHostAllowed(tabInfo.url)) {
          sendResponse({ ok: false, error: 'Host is not allowed for scraping' });
          return;
        }

        const payload = await handleScrape(targetTabId);
        sendResponse({ ok: true, payload });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    // indicate we'll send response asynchronously
    return true;
  }
});