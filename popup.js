document.getElementById('transferDataBtn').addEventListener('click', async () => {
    const statusElement = document.getElementById('status');
    statusElement.textContent = 'Processing...';

    const response = await chrome.runtime.sendMessage({ action: 'startTransfer' });
    
    // Handle the response from the service worker for logging
    if (response.success) {
        statusElement.textContent = 'Data transfer successful!';
        setTimeout(() => {
            statusElement.textContent = '';
        }, 3000);
    } else {
        statusElement.textContent = `Error: ${response.message}`;
    }
});