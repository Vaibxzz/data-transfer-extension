const optionsForm = document.getElementById('optionsForm');
const sourceUrlInput = document.getElementById('sourceUrl');
const destinationUrlInput = document.getElementById('destinationUrl');
const statusElement = document.getElementById('status');

document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.sync.get(['sourceUrl', 'destinationUrl'], (data) => {
        sourceUrlInput.value = data.sourceUrl || '';
        destinationUrlInput.value = data.destinationUrl || '';
    });
});

optionsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const sourceUrl = sourceUrlInput.value;
    const destinationUrl = destinationUrlInput.value;
    
    chrome.storage.sync.set({ sourceUrl, destinationUrl }, () => {
        statusElement.textContent = 'Settings saved!';
        setTimeout(() => {
            statusElement.textContent = '';
        }, 2000);
    });
});