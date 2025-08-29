//For scrapping for first row information.
// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startTransfer') {
        startTransferProcess().then(sendResponse);
        return true;
    }
});

async function startTransferProcess() {
    try {
        const urls = await chrome.storage.sync.get(['sourceUrl', 'destinationUrl']);
        if (!urls.sourceUrl || !urls.destinationUrl) {
            return { success: false, message: 'Please configure the source and destination URLs in the options page.' };
        }

        const [sourceTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!sourceTab || sourceTab.url !== urls.sourceUrl) {
            return { success: false, message: `Please navigate to the source page: ${urls.sourceUrl}` };
        }

        const [scrapingResult] = await chrome.scripting.executeScript({
            target: { tabId: sourceTab.id },
            function: scrapeTableData
        });

        const dataToTransfer = scrapingResult.result;
        if (!dataToTransfer) {
            return { success: false, message: 'Could not find any data with a country on the source page.' };
        }
        
        const destinationTab = await chrome.tabs.create({ url: urls.destinationUrl });

        await new Promise(resolve => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                if (tabId === destinationTab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            });
        });

        await chrome.scripting.executeScript({
            target: { tabId: destinationTab.id },
            function: fillFormWithData,
            args: [dataToTransfer]
        });
        
        return { success: true };

    } catch (error) {
        console.error('Transfer process failed:', error);
        return { success: false, message: error.message };
    }
}

function scrapeTableData() {
    try {
        const table = document.querySelector('table.ws-table-all');
        if (!table) return null;

        for (let i = 1; i < table.rows.length; i++) {
            const row = table.rows[i];
            if (row.cells[2] && row.cells[2].innerText.trim() !== '') {
                return {
                    company: row.cells[0].innerText,
                    contact: row.cells[1].innerText,
                    country: row.cells[2].innerText
                };
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// CORRECTED LOGIC: This function now attempts to split the contact name.
function fillFormWithData(data) {
    try {
        const contactNameParts = data.contact.split(' ');
        const firstName = contactNameParts[0] || '';
        const lastName = contactNameParts.slice(1).join(' ') || '';

        document.getElementById('fname').value = firstName;
        document.getElementById('lname').value = lastName;
        
        const countryDropdown = document.getElementById('country');
        
        if (countryDropdown) {
            const scrapedCountry = data.country.trim();
            let countryFound = false;
            
            for (let i = 0; i < countryDropdown.options.length; i++) {
                if (countryDropdown.options[i].text.trim() === scrapedCountry) {
                    countryDropdown.value = countryDropdown.options[i].value;
                    countryFound = true;
                    break;
                }
            }
            
            if (!countryFound) {
                console.error(`Country '${scrapedCountry}' not found in the dropdown list.`);
            }
        }
        
        alert('Form fields have been filled automatically!');
    } catch (e) {
        console.error('Failed to fill form fields:', e);
    }
}




// exception for the country matchup
/***chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startTransfer') {
        startTransferProcess().then(sendResponse);
        return true;
    }
});

async function startTransferProcess() {
    try {
        const urls = await chrome.storage.sync.get(['sourceUrl', 'destinationUrl']);
        if (!urls.sourceUrl || !urls.destinationUrl) {
            return { success: false, message: 'Please configure the source and destination URLs in the options page.' };
        }

        const [sourceTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!sourceTab || sourceTab.url !== urls.sourceUrl) {
            return { success: false, message: `Please navigate to the source page: ${urls.sourceUrl}` };
        }

        const [scrapingResult] = await chrome.scripting.executeScript({
            target: { tabId: sourceTab.id },
            function: scrapeTableData
        });

        const dataToTransfer = scrapingResult.result;
        if (!dataToTransfer) {
            return { success: false, message: 'Could not find the row for Yoshi Tannamuri in the table or the country is missing.' };
        }
        
        const destinationTab = await chrome.tabs.create({ url: urls.destinationUrl });

        await new Promise(resolve => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
                if (tabId === destinationTab.id && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            });
        });

        await chrome.scripting.executeScript({
            target: { tabId: destinationTab.id },
            function: fillFormWithData,
            args: [dataToTransfer]
        });
        
        return { success: true };

    } catch (error) {
        console.error('Transfer process failed:', error);
        return { success: false, message: error.message };
    }
}

function scrapeTableData() {
    try {
        const table = document.querySelector('table.ws-table-all');
        if (!table) return null;

        for (let i = 1; i < table.rows.length; i++) {
            const row = table.rows[i];
            
            if (row.cells[1] && row.cells[1].innerText.trim() === 'Yoshi Tannamuri' && row.cells[2] && row.cells[2].innerText.trim() !== '') {
                return {
                    company: row.cells[0].innerText,
                    contact: row.cells[1].innerText,
                    country: row.cells[2].innerText
                };
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// CORRECTED LOGIC: The country comparison is now case-insensitive.
function fillFormWithData(data) {
    try {
        const contactNameParts = data.contact.split(' ');
        const firstName = contactNameParts[0] || '';
        const lastName = contactNameParts.slice(1).join(' ') || '';

        document.getElementById('fname').value = firstName;
        document.getElementById('lname').value = lastName;
        
        const countryDropdown = document.getElementById('country');
        
        if (countryDropdown) {
            const scrapedCountry = data.country.trim().toLowerCase();
            let countryFound = false;
            
            for (let i = 0; i < countryDropdown.options.length; i++) {
                const optionText = countryDropdown.options[i].text.trim().toLowerCase();
                
                if (optionText === scrapedCountry) {
                    countryDropdown.value = countryDropdown.options[i].value;
                    countryFound = true;
                    break;
                }
            }
            
            if (!countryFound) {
                console.error(`Country '${data.country.trim()}' not found in the dropdown list.`);
            }
        }
        
        alert('Form fields have been filled automatically!');
    } catch (e) {
        console.error('Failed to fill form fields:', e);
    }
}***/ 