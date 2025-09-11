const optionsForm = document.getElementById('optionsForm');
const settingsSection = document.getElementById('settings-section');
const sourceUrlInput = document.getElementById('sourceUrl');
const destinationUrlInput = document.getElementById('destinationUrl');
const statusElement = document.getElementById('status');
const dashboardBtn = document.getElementById('dashboard-btn');

// Load settings on page load
document.addEventListener('DOMContentLoaded', () => {
    if (settingsSection) {
        loadSavedSettings();
    }
});

// Load previously saved settings
async function loadSavedSettings() {
    const data = await chrome.storage.sync.get(['sourceUrl', 'destinationUrl']);
    if (sourceUrlInput) sourceUrlInput.value = data.sourceUrl || '';
    if (destinationUrlInput) destinationUrlInput.value = data.destinationUrl || '';
}

// Save settings
if (optionsForm) {
    optionsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        const sourceUrl = sourceUrlInput.value;
        const destinationUrl = destinationUrlInput.value;
        
        await chrome.storage.sync.set({ sourceUrl, destinationUrl });
        
        showStatus('Settings saved successfully!', 'success');
    });
}

// Dashboard button
if (dashboardBtn) {
    dashboardBtn.addEventListener('click', () => {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard.html'),
            active: true
        });
    });
}

// Helper function to show status
function showStatus(message, type) {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.className = type;
        setTimeout(() => {
            statusElement.textContent = '';
            statusElement.className = '';
        }, 3000);
    }
}