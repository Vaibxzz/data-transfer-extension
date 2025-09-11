// Claude API integration
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

async function callClaudeAPI(prompt, apiKey) {
    try {
        const response = await fetch(CLAUDE_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-haiku-20240307',
                max_tokens: 1000,
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            })
        });

        if (!response.ok) {
            throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data.content[0].text;
    } catch (error) {
        console.error('Claude API call failed:', error);
        throw error;
    }
}

// SINGLE message listener to handle all actions
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    
    if (request.action === 'proceedTransfer') {
        const dataToTransfer = request.data;

        // Get Claude API key from storage
        const { claudeApiKey } = await chrome.storage.sync.get('claudeApiKey');
        
        if (claudeApiKey) {
            try {
                // Use Claude to enhance/validate the data
                const prompt = `Analyze this contact data and suggest improvements or flag any issues:
                Name: ${dataToTransfer.contact}
                Country: ${dataToTransfer.country}
                Please respond with JSON format: {"validated": true/false, "suggestions": "...", "cleanedName": "...", "cleanedCountry": "..."}`;
                
                const claudeResponse = await callClaudeAPI(prompt, claudeApiKey);
                console.log('Claude analysis:', claudeResponse);
                
                // Parse Claude's response and enhance the data
                try {
                    const analysis = JSON.parse(claudeResponse);
                    if (analysis.cleanedName) {
                        dataToTransfer.contact = analysis.cleanedName;
                    }
                    if (analysis.cleanedCountry) {
                        dataToTransfer.country = analysis.cleanedCountry;
                    }
                    // Store Claude's analysis
                    dataToTransfer.claudeAnalysis = analysis;
                } catch (parseError) {
                    console.log('Claude response was not JSON, storing as text');
                    dataToTransfer.claudeAnalysis = { rawResponse: claudeResponse };
                }
            } catch (error) {
                console.error('Claude API failed, proceeding without enhancement:', error);
            }
        }

        // Save the approved data to storage
        const { approvedEntries = [] } = await chrome.storage.local.get('approvedEntries');
        const entryToSave = {
            ...dataToTransfer,
            timestamp: new Date().toISOString()
        };
        approvedEntries.push(entryToSave);
        await chrome.storage.local.set({ approvedEntries });
        console.log('Data saved to storage:', entryToSave);

        // Get the destination URL from storage
        const { destinationUrl } = await chrome.storage.sync.get('destinationUrl');
        if (!destinationUrl) {
            console.error('Destination URL is not set in the options.');
            return;
        }

        const destinationTab = await chrome.tabs.create({ url: destinationUrl });
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
            function: fillFormAndSubmit,
            args: [dataToTransfer]
        });
    }
    
    // Handle Claude API requests from popup/dashboard
    if (request.action === 'askClaude') {
        const { claudeApiKey } = await chrome.storage.sync.get('claudeApiKey');
        
        if (!claudeApiKey) {
            sendResponse({ error: 'Claude API key not configured' });
            return;
        }
        
        try {
            const response = await callClaudeAPI(request.prompt, claudeApiKey);
            sendResponse({ success: true, response });
        } catch (error) {
            sendResponse({ error: error.message });
        }
    }
});

function fillFormAndSubmit(data) {
    try {
        const contactNameParts = data.contact.split(' ');
        const firstName = contactNameParts[0] || '';
        const lastName = contactNameParts.slice(1).join(' ') || '';

        document.getElementById('fname').value = firstName;
        document.getElementById('lname').value = lastName;

        const countryDropdown = document.getElementById('country');
        if (countryDropdown) {
            const scrapedCountry = data.country.trim().toLowerCase();
            for (let i = 0; i < countryDropdown.options.length; i++) {
                const optionText = countryDropdown.options[i].text.trim().toLowerCase();
                if (optionText === scrapedCountry) {
                    countryDropdown.value = countryDropdown.options[i].value;
                    break;
                }
            }
        }

        const submitButton = document.querySelector('input[type="submit"], button[type="submit"]');
        if (submitButton) {
            submitButton.click();
        }
    } catch (e) {
        console.error('Failed to fill form fields:', e);
    }
}
