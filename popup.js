// Simple Form Filler Popup
document.addEventListener('DOMContentLoaded', () => {
    const cancelBtn = document.getElementById('cancel-btn');
    const fillBtn = document.getElementById('fill-btn');
    
    // Cancel button
    cancelBtn.addEventListener('click', () => {
        window.close();
    });
    
    // Fill button
    fillBtn.addEventListener('click', async () => {
        try {
            fillBtn.disabled = true;
            fillBtn.textContent = 'Filling...';
            
            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                alert('No active tab found');
                return;
            }
            
            console.log('Filling form in tab:', tab.url);
            
            // Inject script to fill form
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => {
                    // Show alert to prove script is running
                    alert('🎯 SCRIPT RUNNING! Filling form...');
                    
                    try {
                        // Get all form inputs
                        const inputs = document.querySelectorAll('input, select, textarea');
                        console.log('Found', inputs.length, 'form elements');
                        
                        // Test data to fill
                        const testData = ['John Doe', 'john@example.com', 'USA', 'Hello World!'];
                        
                        let filled = 0;
                        
                        // Fill first few inputs
                        inputs.forEach((input, index) => {
                            if (index < testData.length && !input.value) {
                                input.value = testData[index];
                                
                                // Trigger events
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                                input.dispatchEvent(new Event('change', { bubbles: true }));
                                
                                filled++;
                                console.log('Filled input', index, ':', input.tagName, input.type, input.id);
                            }
                        });
                        
                        console.log('Filled', filled, 'fields');
                        alert(`✅ SUCCESS! Filled ${filled} fields with test data!`);
                        
                        return {
                            success: true,
                            filled: filled,
                            total: inputs.length
                        };
                        
                    } catch (error) {
                        console.error('Error:', error);
                        alert('❌ Error: ' + error.message);
                        return { success: false, error: error.message };
                    }
                }
            });
            
            console.log('Script result:', result);
            
            if (result && result[0] && result[0].result) {
                const scriptResult = result[0].result;
                
                if (scriptResult.success) {
                    alert(`✅ Form filled successfully! Filled ${scriptResult.filled} fields.`);
                    window.close();
                } else {
                    alert('❌ Failed to fill form: ' + scriptResult.error);
                }
            } else {
                alert('❌ No result from script');
            }
            
        } catch (error) {
            console.error('Error:', error);
            alert('❌ Error: ' + error.message);
        } finally {
            fillBtn.disabled = false;
            fillBtn.textContent = 'Fill Form';
        }
    });
});
