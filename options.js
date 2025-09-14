// options.js - safe, extension + local dev friendly

// DOM refs
const optionsForm = document.getElementById('optionsForm');
const settingsSection = document.getElementById('settings-section');
const sourceUrlInput = document.getElementById('sourceUrl');
const destinationUrlInput = document.getElementById('destinationUrl');
const statusElement = document.getElementById('status');
const dashboardBtn = document.getElementById('dashboard-btn');

// -------------------- Robust storage helpers --------------------
// (copy of helpers you had — returns Promises)
function hasChromeStorage() {
  return (typeof chrome !== 'undefined' && chrome.storage);
}
function getChromeStorageArea() {
  if (!hasChromeStorage()) return null;
  if (chrome.storage.sync) return chrome.storage.sync;
  if (chrome.storage.local) return chrome.storage.local;
  return null;
}
function storageGet(keys) {
  return new Promise((resolve) => {
    const area = getChromeStorageArea();
    if (area) {
      try {
        area.get(keys, (result) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('chrome.storage.get error', chrome.runtime.lastError);
            resolve(storageGetLocal(keys));
            return;
          }
          resolve(result || {});
        });
      } catch (e) {
        console.warn('chrome.storage.get threw', e);
        resolve(storageGetLocal(keys));
      }
    } else {
      resolve(storageGetLocal(keys));
    }
  });
}
function storageSet(obj) {
  return new Promise((resolve) => {
    const area = getChromeStorageArea();
    if (area) {
      try {
        area.set(obj, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('chrome.storage.set error', chrome.runtime.lastError);
            storageSetLocal(obj); resolve(); return;
          }
          resolve();
        });
      } catch (e) {
        console.warn('chrome.storage.set threw', e);
        storageSetLocal(obj); resolve();
      }
    } else {
      storageSetLocal(obj); resolve();
    }
  });
}
function storageRemove(keys) {
  return new Promise((resolve) => {
    const area = getChromeStorageArea();
    if (area) {
      try {
        area.remove(keys, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            console.warn('chrome.storage.remove error', chrome.runtime.lastError);
            storageRemoveLocal(keys); resolve(); return;
          }
          resolve();
        });
      } catch (e) {
        console.warn('chrome.storage.remove threw', e);
        storageRemoveLocal(keys); resolve();
      }
    } else {
      storageRemoveLocal(keys); resolve();
    }
  });
}
function storageGetLocal(keys) {
  const out = {};
  if (Array.isArray(keys)) {
    keys.forEach(k => {
      try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e) { out[k] = localStorage.getItem(k); }
    });
  } else if (typeof keys === 'string') {
    try { out[keys] = JSON.parse(localStorage.getItem(keys)); } catch(e) { out[keys] = localStorage.getItem(keys); }
  } else if (typeof keys === 'object' && keys !== null) {
    Object.keys(keys).forEach(k => {
      try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e) { out[k] = localStorage.getItem(k); }
      if (out[k] === null || out[k] === undefined) out[k] = keys[k];
    });
  } else {
    // return all keys if keys === null/undefined requested
    try {
      Object.keys(localStorage).forEach(k => {
        try { out[k] = JSON.parse(localStorage.getItem(k)); } catch(e) { out[k] = localStorage.getItem(k); }
      });
    } catch (e) {}
  }
  return out;
}
function storageSetLocal(obj) {
  Object.keys(obj || {}).forEach(k => {
    try { localStorage.setItem(k, JSON.stringify(obj[k])); } catch (e) { localStorage.setItem(k, String(obj[k])); }
  });
}
function storageRemoveLocal(keys) {
  if (Array.isArray(keys)) keys.forEach(k => localStorage.removeItem(k));
  else localStorage.removeItem(keys);
}
// ------------------ end storage helpers ------------------

// Load settings on page load
document.addEventListener('DOMContentLoaded', () => {
  if (settingsSection) {
    loadSavedSettings().catch(e => console.warn('loadSavedSettings failed', e));
  }
});

// Load previously saved settings (uses storageGet instead of chrome.storage.sync)
async function loadSavedSettings() {
  try {
    // pass keys as array to storageGet
    const data = await storageGet(['sourceUrl', 'destinationUrl']);
    if (sourceUrlInput) sourceUrlInput.value = data.sourceUrl || '';
    if (destinationUrlInput) destinationUrlInput.value = data.destinationUrl || '';
    console.log('[options] loaded settings', data);
  } catch (err) {
    console.error('Error loading settings', err);
  }
}

// Save settings: use storageSet helper (works for extension or local)
if (optionsForm) {
  optionsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sourceUrl = sourceUrlInput ? sourceUrlInput.value.trim() : '';
    const destinationUrl = destinationUrlInput ? destinationUrlInput.value.trim() : '';

    try {
      await storageSet({ sourceUrl, destinationUrl });
      showStatus('Settings saved successfully!', 'success');
      console.log('[options] saved', { sourceUrl, destinationUrl });
    } catch (err) {
      console.error('Error saving settings', err);
      showStatus('Failed to save settings', 'error');
    }
  });
}

// Dashboard button: use chrome.tabs.create if available, otherwise fallback to normal navigation
if (dashboardBtn) {
  dashboardBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // extension path first
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.runtime && chrome.runtime.getURL) {
      try {
        chrome.tabs.create({
          url: chrome.runtime.getURL('dashboard.html'),
          active: true
        });
        return;
      } catch (err) {
        console.warn('chrome.tabs.create failed', err);
      }
    }
    // fallback for local testing: open relative path
    try {
      // if options.html is in repo root and dashboard.html is in same root
      window.location.href = window.location.origin + '/dashboard.html';
    } catch (err) {
      // final fallback: try relative navigation
      window.location.href = 'dashboard.html';
    }
  });
}

// Helper function to show status
function showStatus(message, type) {
  if (statusElement) {
    statusElement.textContent = message;
    statusElement.className = type || '';
    setTimeout(() => {
      statusElement.textContent = '';
      statusElement.className = '';
    }, 3000);
  } else {
    console.log('[status]', type, message);
  }
}