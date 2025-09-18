// Robust popup init wrapper: catches errors and shows Options link if anything fails
(async function robustPopupInit() {
    try {
      // your existing popup init code goes here (copy/paste the body of your current init)
      // e.g. await initUi(); or the content that reads storage and renders transferUi
  
      // EXAMPLE fallback UI logic (safe and minimal):
      const transferUi = document.getElementById('transfer-ui') || document.body;
      // Try to load config
      let data = {};
      if (chrome && chrome.storage && chrome.storage.sync) {
        data = await new Promise(resolve => chrome.storage.sync.get(['sourceUrl'], r => resolve(r || {})));
      } else {
        data.sourceUrl = localStorage.getItem('sourceUrl') || '';
      }
  
      if (!data.sourceUrl) {
        transferUi.innerHTML = `
          <h3>Configuration Needed</h3>
          <p>Source URL is not set. Please configure it in the
          <a id="open-options" href="#">options page</a>.</p>
        `;
        document.getElementById('open-options').addEventListener('click', (e) => {
          e.preventDefault();
          // open options robustly
          if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
          } else {
            window.open(chrome.runtime.getURL('options.html'), '_blank');
          }
        });
        return;
      }
  
      // rest of normal popup logic goes here...
    } catch (err) {
      // show user-friendly message and log full error for debugging
      console.error('popup init error', err);
      const transferUi = document.getElementById('transfer-ui') || document.body;
      transferUi.innerHTML = `
        <h3>KOSH</h3>
        <p style="color:#dc2626">An error occurred.</p>
        <p><a id="open-options2" href="#">Open options to configure</a></p>
        <pre style="white-space:pre-wrap">${String(err).slice(0,200)}</pre>
      `;
      document.getElementById('open-options2').addEventListener('click', (e) => {
        e.preventDefault();
        if (chrome && chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
        else window.open(chrome.runtime.getURL('options.html'), '_blank');
      });
    }
  })();

let scrapedData = [];
let currentItemIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
    const transferUi = document.getElementById('transfer-ui');
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const data = await chrome.storage.sync.get(['sourceUrl']);

        if (!data.sourceUrl) {
            transferUi.innerHTML = `
                <h3>Configuration Needed</h3>
                <p>Source URL is not set. Please configure it in the 
                <a href="options.html" target="_blank">options page</a>.</p>
            `;
            return;
        }

        if (tab.url !== data.sourceUrl) {
            transferUi.innerHTML = `
                <h3>Wrong Page</h3>
                <p>This is not the configured source page. Please navigate to the correct URL.</p>
            `;
            return;
        }

        const scrapingResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: scrapeTableData
        });

        scrapedData = scrapingResult[0].result;

        if (!scrapedData || scrapedData.length === 0) {
            transferUi.innerHTML = "<h3 style='color:red;'>No data found on the page.</h3>";
            return;
        }

        showModal(scrapedData[currentItemIndex]);
    } catch (error) {
        transferUi.innerHTML = "<h3 style='color:red;'>An error occurred.</h3>";
        console.error(error);
    }
});

function scrapeTableData() {
    const table = document.querySelector('table.ws-table-all');
    if (!table) return null;
    const scrapedItems = [];
    const rows = Array.from(table.rows);
    for (let i = 1; i < rows.length; i++) {
        const cells = Array.from(rows[i].cells);
        if (cells.length > 2) {
            const contact = cells[1].innerText.trim();
            const country = cells[2].innerText.trim();
            if (contact && country) {
                scrapedItems.push({ contact, country });
            }
        }
    }
    return scrapedItems;
}

function showModal(data) {
    const [firstName, ...rest] = data.contact.split(' ');
    const lastName = rest.join(' ');
    const transferUi = document.getElementById('transfer-ui');

    transferUi.innerHTML = `
        <div class="modal-content" style="border:none; padding:15px;">
            <h3>Send to Product B?</h3>
            <div class="card-item">
                <p><span class="label">First Name:</span> ${firstName}</p>
            </div>
            <div class="card-item">
                <p><span class="label">Last Name:</span> ${lastName}</p>
            </div>
            <div class="card-item">
                <p><span class="label">Country:</span> ${data.country}</p>
            </div>
            <div class="buttons-container">
                <button class="cancel">Cancel</button>
                <button class="proceed">Proceed</button>
            </div>
        </div>
    `;

    document.querySelector('.proceed').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'proceedTransfer', data });
        currentItemIndex++;
        if (currentItemIndex < scrapedData.length) {
            showModal(scrapedData[currentItemIndex]);
        } else {
            transferUi.innerHTML = "<h3 style='color:green;'>All transfers complete!</h3>";
            setTimeout(() => window.close(), 1500);
        }
    });

    document.querySelector('.cancel').addEventListener('click', () => window.close());
}