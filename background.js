// background.js (MV3 service worker)
// Listens for action click or messages from UI, injects a scraper into the active tab,
// collects W3C-ish table data and stores it into chrome.storage for the UI page to display.

'use strict';

// Utility: run scraper in the page and return the result
async function runScraperInTab(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      // function to run in page context: returns a serializable object
      func: () => {
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
            // If firstRow used as headers, skip it for row parsing below
            firstRow.removeAttribute('data-kosh-temp-header');
          }
        }

        // Build rows: iterate over tr elements, skip header row if it's thead or first <tr> when it had ths
        const rows = [];
        const trs = Array.from(table.querySelectorAll('tr'));
        for (const tr of trs) {
          // skip empty rows
          const cells = Array.from(tr.children).filter(n => /td|th/i.test(n.tagName));
          if (!cells.length) continue;

          // If header-like row (all th), skip it
          const allTh = cells.every(c => c.tagName.toLowerCase() === 'th');
          if (allTh) continue;

          const row = {};
          cells.forEach((cell, i) => {
            const key = headers[i] || `col${i + 1}`;
            // innerText may be preferable to get visible text
            row[key] = cell.innerText.trim();
          });
          // only add non-empty rows
          if (Object.keys(row).length) rows.push(row);
        }

        return { ok: true, headers, rows, rowCount: rows.length };
      }
    });
    return result;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Save results to chrome.storage and notify UI
async function handleScrape(tabId) {
  const res = await runScraperInTab(tabId);
  const time = new Date().toISOString();
  const payload = { fetchedAt: time, result: res };

  await chrome.storage.local.set({ lastScrape: payload });
  // notify all UI pages
  chrome.runtime.sendMessage({ type: 'SCRAPE_COMPLETE', payload });
  return payload;
}

// respond to toolbar action (click)
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const info = await handleScrape(tab.id);
  // open the background UI page in a new tab to show results (optional)
  const url = chrome.runtime.getURL('background.html');
  chrome.tabs.create({ url });
});

// also respond to messages from UI (background.html)
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