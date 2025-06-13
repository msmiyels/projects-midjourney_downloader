// popup.js - Handles interactions within the extension's popup window.

// --- Get References to UI Elements ---
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');
const scraperTabContent = document.getElementById('tabContentScraper');
const scraperControlsContainer = document.getElementById('scraperControlsContainer');
const scraperWrongPageMsg = document.getElementById('scraperWrongPageMsg');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const statusScraperDiv = document.getElementById('statusScraper');
const dataCountScraperP = document.getElementById('dataCountScraper');
const downloaderTabContent = document.getElementById('tabContentDownloader');
const uploadButton = document.getElementById('uploadButton');
const csvFileInput = document.getElementById('csvFileInput');
const uploadFiltersDiv = document.getElementById('uploadFilters');
const urlColumnSelect = document.getElementById('urlColumnSelect');
const rowLimitInput = document.getElementById('rowLimitInput');
const actionFilterContainer = document.getElementById('actionFilterContainer');
const statusUploadDiv = document.getElementById('statusUpload');
const dataCountUploadP = document.getElementById('dataCountUpload');
const noFiltersPlaceholder = document.querySelector('.no-filters-placeholder');
const downloadCsvButton = document.getElementById('downloadCsvButton');
const currentFileStatusP = document.getElementById('currentFileStatus');

// --- State Variables ---
let currentDataSource = 'none'; // 'scraper', 'upload', or 'none'
let activeTabId = 'scraper';    // 'scraper' or 'downloader'
let processedUploadDataInfo = null; // Will hold { headers, validUrlHeaders, urlCountsPerColumn, totalRows, actions, count }
let activeActionFilters = new Set();
let isImaginePage = false;

/**
 * Checks if the active browser tab is a Midjourney "/imagine" page and updates the scraper UI accordingly.
 *
 * Updates UI elements to show or hide scraper controls and warning messages based on the current tab's URL.
 *
 * @returns {Promise<boolean>} True if the active tab is the target "/imagine" page; otherwise, false.
 */

async function checkActiveTabAndUpdateScraperUI() {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const targetUrlPattern = /https?:\/\/www\.midjourney\.com\/imagine/i;
        if (activeTab && activeTab.url && targetUrlPattern.test(activeTab.url)) {
            isImaginePage = true;
            if (scraperControlsContainer) scraperControlsContainer.classList.remove('hidden');
            if (scraperWrongPageMsg) scraperWrongPageMsg.classList.add('hidden');
        } else {
            isImaginePage = false;
            if (scraperControlsContainer) scraperControlsContainer.classList.add('hidden');
            if (scraperWrongPageMsg) scraperWrongPageMsg.classList.remove('hidden');
            updateStatus('scraper', "Unavailable (Not on /imagine page)", 0, 'info');
        }
        return isImaginePage;
    } catch (error) {
        console.error("Error checking active tab:", error);
        isImaginePage = false;
        if (scraperControlsContainer) scraperControlsContainer.classList.add('hidden');
        if (scraperWrongPageMsg) {
            scraperWrongPageMsg.textContent = "Error checking current page.";
            scraperWrongPageMsg.classList.remove('hidden');
        }
        return false;
    }
}

/**
 * Switches the visible tab in the popup UI and updates related state and controls.
 *
 * Activates the specified tab, updates button styles, and ensures the correct tab content is displayed. If switching to the "scraper" tab, checks the active browser tab and updates scraper controls accordingly. Refreshes UI state and button availability without resetting upload data.
 *
 * @param {string} tabId - The ID of the tab to activate ("scraper" or "downloader").
 */
async function showTab(tabId) {
    console.log(`Switching to tab: ${tabId}`);
    activeTabId = tabId;
    tabContents.forEach(content => content.classList.remove('active'));
    tabButtons.forEach(button => {
        button.classList.remove('active');
        if (button.dataset.tab === tabId) button.classList.add('active');
    });
    const activeContent = document.getElementById(`tabContent${tabId.charAt(0).toUpperCase() + tabId.slice(1)}`);
    if (activeContent) activeContent.classList.add('active');

    if (tabId === 'scraper') {
        await checkActiveTabAndUpdateScraperUI();
    }
    // Update state and button texts when tab visibility changes.
    // Pass false to avoid resetting upload UI if it's already populated and user is just switching tabs.
    requestAndUpdateState(false);
}

/**
 * Updates the status message and data count display for the specified UI section.
 *
 * Adjusts visibility and styling of the status area based on the provided message, count, and type. For the "scraper" section, status is only shown if the user is on the target page. For the "upload" section, the status may be shown if there is a nonzero count even without a message.
 *
 * @param {'scraper'|'upload'} section - The UI section to update.
 * @param {string} message - The status message to display.
 * @param {?number} [count=null] - The data count to display; if null, defaults to 0.
 * @param {'info'|'success'|'warning'|'error'|'partial-info'} [type='info'] - The status type, affecting styling.
 */
function updateStatus(section, message, count = null, type = 'info') {
    console.log(`Popup Status [${section}, ${type}]:`, message, "Count:", count);
    let statusDiv = section === 'scraper' ? statusScraperDiv : statusUploadDiv;
    let countP = section === 'scraper' ? dataCountScraperP : dataCountUploadP;
    let countLabel = section === 'scraper' ? 'Data collected' : 'Data processed';

    if (statusDiv) {
        const statusP = statusDiv.querySelector('p:first-child');
        if (statusP) statusP.textContent = `Status: ${message}`;

        let shouldBeVisible = (message && message.trim() !== '');
        if (section === 'scraper' && !isImaginePage) {
            shouldBeVisible = false;
        }
        // Ensure data count visibility is also considered for overall visibility
        if (count !== null && count > 0 && section === 'upload') {
            shouldBeVisible = true;
        }


        if (shouldBeVisible) {
            statusDiv.classList.remove('hidden');
        } else {
            statusDiv.classList.add('hidden');
        }

        statusDiv.classList.remove('status-info', 'status-success', 'status-warning', 'status-error', 'status-partial-info');
        if (shouldBeVisible && type) {
            statusDiv.classList.add(`status-${type}`);
        }
    }

    if (countP) { // Update count display regardless of main message visibility for consistency
        countP.textContent = `${countLabel}: ${count !== null ? count : 0}`;
    }
}

/**
 * Updates the detailed status message and filter visibility for the upload tab based on the current state of processed upload data.
 *
 * Displays appropriate messages for cases such as missing or invalid URL columns, absence of data rows, or partial validity of URLs in the selected column. Shows or hides upload filters depending on data validity and user selection.
 */
function updateDetailedUploadStatus() {
    if (!statusUploadDiv) return; // Ensure the status div exists

    // Standardly hide filters, will be re-enabled explicitly below
    if (uploadFiltersDiv) uploadFiltersDiv.classList.add('hidden');

    if (!processedUploadDataInfo || !processedUploadDataInfo.headers) {
        updateStatus('upload', "Waiting for upload", 0, 'info');
        return;
    }

    const totalRowCount = processedUploadDataInfo.totalRows || 0;
    const hasHeaders = processedUploadDataInfo.headers && processedUploadDataInfo.headers.length > 0;
    const hasValidUrlCols = processedUploadDataInfo.validUrlHeaders && processedUploadDataInfo.validUrlHeaders.length > 0;
    let statusMsg = "";
    let statusType = 'info'; // Standard type
    let showFilters = false; // Standardly do not show filters

    if (totalRowCount > 0 && !hasValidUrlCols) {
        // Case 1: Data exists but no valid URL columns -> Main warning
        statusMsg = "No valid download URL found.";
        statusType = 'warning';
        // Filters remain hidden (standard from above)
    } else if (totalRowCount === 0) {
        // Case 2: No data rows processed
        if (hasHeaders) { // CSV had headers but no data rows
            statusMsg = "Processed: No data rows found.";
        } else { // No headers, no data (e.g., completely empty file or before first upload)
            statusMsg = "Waiting for upload";
        }
        // Filters remain hidden
    } else if (totalRowCount > 0 && hasValidUrlCols) {
        // Case 3: Data exists AND valid URL columns exist
        const selectedColumn = urlColumnSelect ? urlColumnSelect.value : null;

        // Check if selectedColumn is actually valid and present in processedUploadDataInfo.validUrlHeaders
        if (!selectedColumn || !(processedUploadDataInfo.validUrlHeaders || []).includes(selectedColumn)) {
            statusMsg = "Error: No valid URL column selected for download.";
            statusType = 'error';
            // Filters remain hidden
        } else {
            const validUrlCountInSelectedColumn = processedUploadDataInfo.urlCountsPerColumn[selectedColumn] || 0;

            if (validUrlCountInSelectedColumn < totalRowCount) {
                // Not all entries in the selected column are valid
                statusMsg = `${validUrlCountInSelectedColumn} of ${totalRowCount} entries valid.`;
                statusType = 'partial-info'; // New subtle highlighting class
            } else {
                // All entries in the selected column are valid
                statusMsg = "Data processed"; // Generic status, omitting validity details
                statusType = 'info'; // Or 'success', if desired
            }
            showFilters = true; // Show filters
        }
    } else {
        // General fallback, e.g., if processedUploadDataInfo exists but totalRowCount is 0 and no headers (unlikely)
        statusMsg = "Waiting for upload";
        // Filters remain hidden
    }

    updateStatus('upload', statusMsg, totalRowCount, statusType);

    // Show/hide filters based on the showFilters variable
    if (uploadFiltersDiv) {
        if (showFilters) {
            uploadFiltersDiv.classList.remove('hidden');
        } else {
            uploadFiltersDiv.classList.add('hidden');
        }
    }
}


/**
 * Resets the upload UI to its initial state, clearing file inputs, filters, and status messages.
 *
 * Also resets internal upload-related state and updates the UI to reflect that no upload data is present.
 */
function resetUploadUI() {
    console.log("Resetting Upload UI (Downloader Tab)");
    if (csvFileInput) csvFileInput.value = null; // Clear the file input

    if (uploadFiltersDiv) uploadFiltersDiv.classList.add('hidden');

    if (urlColumnSelect) urlColumnSelect.innerHTML = '<option value="" disabled selected>-- Select --</option>';
    if (rowLimitInput) rowLimitInput.value = '';
    if (actionFilterContainer) actionFilterContainer.innerHTML = '<span class="no-filters-placeholder">No actions found.</span>';

    const wasError = statusUploadDiv && statusUploadDiv.classList.contains('status-error');

    processedUploadDataInfo = null;
    activeActionFilters.clear();

    if (currentDataSource === 'upload') {
        currentDataSource = 'none';
    }

    if (statusUploadDiv && !wasError) {
        statusUploadDiv.classList.remove('status-warning', 'status-partial-info');
    }
    // requestAndUpdateState(false) will call updateDetailedUploadStatus, which sets the "Waiting for upload" status.
    requestAndUpdateState(false);
}

/**
 * Updates the enabled or disabled state of UI buttons based on the current scraping status, active tab, and data availability.
 *
 * Adjusts the start, stop, upload, and download buttons to reflect whether scraping is running, whether the user is on the correct page, and whether valid data is available for download in the current context.
 *
 * @param {boolean} isScrapingRunning - Indicates if a scraping operation is currently in progress.
 * @param {boolean|null} [scraperHasData=null] - Whether the scraper has collected data; relevant for enabling download in the scraper tab.
 * @param {boolean|null} [uploadDataHasRows=null] - Whether the uploaded CSV contains data rows; relevant for enabling download in the downloader tab.
 */
function updateButtonStates(isScrapingRunning, scraperHasData = null, uploadDataHasRows = null) {
    // uploadDataHasRows is true if processedUploadDataInfo.totalRows > 0

    if (startButton) startButton.disabled = !isImaginePage || isScrapingRunning;
    if (stopButton) stopButton.disabled = !isImaginePage || !isScrapingRunning;
    if (uploadButton) uploadButton.disabled = isScrapingRunning;

    let canDownload = false;
    let selectedColumnHasMinOneValidEntry = false; // For downloader-specific check
    const overallValidUrlColumnsExist = processedUploadDataInfo?.validUrlHeaders?.length > 0;

    if (!isScrapingRunning) {
        if (activeTabId === 'downloader') {
            // Conditions for download in the Downloader tab:
            // 1. CSV was processed and has rows (uploadDataHasRows).
            // 2. There are valid URL columns in the CSV (overallValidUrlColumnsExist).
            // 3. The currently selected column has at least one valid URL entry.
            if (uploadDataHasRows && overallValidUrlColumnsExist && urlColumnSelect && processedUploadDataInfo?.urlCountsPerColumn) {
                const selectedColumn = urlColumnSelect.value;
                // Is the selected column not the "No valid..." option and does it have entries?
                if (selectedColumn &&
                    urlColumnSelect.selectedIndex !== -1 &&
                    !urlColumnSelect.options[urlColumnSelect.selectedIndex]?.disabled &&
                    (processedUploadDataInfo.urlCountsPerColumn[selectedColumn] || 0) > 0) {
                    selectedColumnHasMinOneValidEntry = true;
                }
            }
            if (uploadDataHasRows && overallValidUrlColumnsExist && selectedColumnHasMinOneValidEntry) {
                canDownload = true;
            }
        } else if (activeTabId === 'scraper') { // Check if scraper has data
            if (scraperHasData === true) {
                canDownload = true;
            }
        }
    }

    if (downloadCsvButton) {
        downloadCsvButton.disabled = !canDownload;
        // Set text based on the active tab
        if (activeTabId === 'downloader') {
            downloadCsvButton.textContent = 'Start Image Download';
        } else {
            downloadCsvButton.textContent = 'Download CSV';
        }
    }

    console.log(`Button States: \n` +
        `  isImaginePage: ${isImaginePage}\n` +
        `  isScrapingRunning: ${isScrapingRunning}\n` +
        `  scraperHasData: ${scraperHasData}\n` +
        `  uploadDataHasRows: ${uploadDataHasRows}\n` +
        `  overallValidUrlColumnsExist: ${overallValidUrlColumnsExist}\n` +
        `  selectedColumn: ${urlColumnSelect ? urlColumnSelect.value : 'N/A'}\n` +
        `  selectedColumnHasMinOneValidEntry: ${selectedColumnHasMinOneValidEntry}\n` +
        `  currentDataSource: ${currentDataSource}\n` +
        `  activeTabId: ${activeTabId}\n` +
        `  canDownload: ${canDownload}\n` +
        `  downloadBtnDisabled: ${downloadCsvButton ? downloadCsvButton.disabled : 'N/A'}`
    );
}


// --- Event Listeners ---

tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        const tabId = button.dataset.tab;
        showTab(tabId);
    });
});

startButton.addEventListener('click', async () => {
    console.log('Start button clicked');
    resetUploadUI();
    currentDataSource = 'scraper';
    updateStatus('scraper', "Starting...", null, 'info');
    updateButtonStates(true, false, processedUploadDataInfo?.count > 0);

    try {
        const [tab] = await chrome.tabs.query({ active: true, url: "*://*.midjourney.com/*" });
        if (tab) {
            console.log(`Sending start-scraping message to tab ID: ${tab.id}`);
            chrome.tabs.sendMessage(tab.id, { action: "start-scraping" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending start message:", chrome.runtime.lastError.message);
                    updateStatus('scraper', `Error: ${chrome.runtime.lastError.message}`, null, 'error');
                    currentDataSource = 'none';
                    requestAndUpdateState();
                } else if (response && (response.status === "started" || response.status === "already_running")) {
                    updateStatus('scraper', "Running...", null, 'info');
                    // isScrapingRunning will be updated by background message
                } else {
                    console.warn("Unexpected response or failed start:", response);
                    updateStatus('scraper', response?.message || "Failed start", null, 'warning');
                    currentDataSource = 'none';
                    requestAndUpdateState();
                }
            });
        } else {
            updateStatus('scraper', "Error: No active Midjourney tab found.", null, 'error');
            currentDataSource = 'none';
            updateButtonStates(false, false, processedUploadDataInfo?.count > 0);
        }
    } catch (error) {
        console.error("Error querying tabs:", error);
        updateStatus('scraper', `Error: ${error.message}`, null, 'error');
        currentDataSource = 'none';
        updateButtonStates(false, false, processedUploadDataInfo?.count > 0);
    }
});

stopButton.addEventListener('click', async () => {
    console.log('Stop button clicked');
    updateStatus('scraper', "Stopping...", null, 'info');
    // Optimistic UI update for button states
    if (startButton) startButton.disabled = true;
    // downloadCsvButton.disabled = true; // Will be re-evaluated by requestAndUpdateState
    // uploadButton.disabled = true; // Will be re-evaluated by requestAndUpdateState


    try {
        const [tab] = await chrome.tabs.query({ active: true, url: "*://*.midjourney.com/*" });
        if (tab) {
            console.log(`Sending stop-scraping message to tab ID: ${tab.id}`);
            chrome.tabs.sendMessage(tab.id, { action: "stop-scraping" }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error sending stop message:", chrome.runtime.lastError.message);
                    updateStatus('scraper', `Error: ${chrome.runtime.lastError.message}`, null, 'error');
                } else if (response && (response.status === "stopped" || response.status === "already_stopped")) {
                    updateStatus('scraper', "Stopped. Processing...", null, 'info');
                } else {
                    console.warn("Unexpected response from stop command:", response);
                    updateStatus('scraper', "Stop request sent", null, 'info');
                }
                requestAndUpdateState(); // Always update from background after attempt
            });
        } else {
            updateStatus('scraper', "Error: No active Midjourney tab found.", null, 'error');
            requestAndUpdateState();
        }
    } catch (error) {
        console.error("Error querying tabs:", error);
        updateStatus('scraper', `Error: ${error.message}`, null, 'error');
        requestAndUpdateState();
    }
});

uploadButton.addEventListener('click', () => {
    if (csvFileInput) {
        csvFileInput.click();
    }
});

if (csvFileInput) {
    csvFileInput.addEventListener('change', (event) => {
        const file = event.target.files ? event.target.files[0] : null;
        if (!file) { console.log("No file selected."); return; }
        if (!file.name.toLowerCase().endsWith('.csv')) {
            updateStatus('upload', "Error: Please select a CSV file.", 0, 'error');
            resetUploadUI();
            csvFileInput.value = null; // Clear file input
            return;
        }
        console.log(`File selected: ${file.name}`);
        updateStatus('upload', "Reading file...", 0, 'info');
        // updateButtonStates(true, null, false); // Temporarily disable buttons while processing

        const reader = new FileReader();
        reader.onload = (e) => {
            const fileContent = e.target?.result;
            if (typeof fileContent === 'string') {
                console.log("File read successfully. Sending to background for processing.");
                updateStatus('upload', "Processing ...", 0, 'info'); // More direct status
                chrome.runtime.sendMessage({ action: "process-uploaded-csv", content: fileContent }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error sending CSV content message:", chrome.runtime.lastError.message);
                        updateStatus('upload', `Error sending to background: ${chrome.runtime.lastError.message}`, 0, 'error');
                        resetUploadUI();
                    } else if (response && response.status === 'processing_started') {
                        // updateStatus('upload', "Processing CSV in background...", 0, 'info'); // Status already set
                        // Background will send "upload_processed_result"
                    } else {
                        console.warn("Unexpected immediate response for process-uploaded-csv:", response);
                        updateStatus('upload', "Unexpected response from background.", 0, 'warning');
                        resetUploadUI();
                    }
                });
            } else {
                updateStatus('upload', "Error: Could not read file content.", 0, 'error');
                resetUploadUI();
            }
        };
        reader.onerror = () => {
            console.error("FileReader error:", reader.error);
            updateStatus('upload', `Error reading file: ${reader.error?.message || 'Unknown'}`, 0, 'error');
            resetUploadUI();
        };
        reader.readAsText(file);
        csvFileInput.value = null; // Clear file input after selection
    });
}

downloadCsvButton.addEventListener('click', () => {
    const statusSectionToUpdate = activeTabId === 'downloader' ? 'upload' : 'scraper'; // Use activeTabId for status context
    console.log(`Download button clicked for tab: ${activeTabId}. Current data source: ${currentDataSource}`);
    updateStatus(statusSectionToUpdate, "Preparing download...", null, 'info');

    if (downloadCsvButton) downloadCsvButton.disabled = true;

    let downloadOptions = {};
    // Determine source for download based on activeTabId, then confirm data availability for that source
    if (activeTabId === 'downloader' && processedUploadDataInfo && processedUploadDataInfo.totalRows > 0) {
        const selectedUrlColumn = urlColumnSelect ? urlColumnSelect.value : null;
        // Check if selectedUrlColumn is actually valid and present in processedUploadDataInfo.validUrlHeaders
        if (!selectedUrlColumn || !(processedUploadDataInfo.validUrlHeaders || []).includes(selectedUrlColumn)) {
            updateStatus('upload', "Error: No valid URL column selected for download.", processedUploadDataInfo.totalRows, 'error');
            requestAndUpdateState(false); // Re-enable buttons based on actual state
            return;
        }

        const rowLimit = rowLimitInput ? parseInt(rowLimitInput.value, 10) : 0;
        downloadOptions = {
            source: 'upload',
            urlColumn: selectedUrlColumn,
            limit: (!isNaN(rowLimit) && rowLimit > 0) ? rowLimit : null,
            actionFilters: Array.from(activeActionFilters)
        };
    } else if (activeTabId === 'scraper') { // Check if scraper has data
        downloadOptions = { source: 'scraper' };
    } else {
        console.warn("Download clicked but conditions not met for either tab.");
        updateStatus(statusSectionToUpdate, "No data available or tab context unclear.", null, 'warning');
        requestAndUpdateState(false); // Re-enable buttons
        return;
    }

    console.log("Download options:", downloadOptions);

    // HERE IS THE CORRECTION: Determine the correct action based on the active tab
    const actionToPerform = activeTabId === 'downloader' ? 'start-image-download' : 'download-csv';

    chrome.runtime.sendMessage({ action: actionToPerform, options: downloadOptions }, (response) => {
        const finalStatusSection = downloadOptions.source === 'upload' ? 'upload' : 'scraper';

        if (chrome.runtime.lastError) {
            console.error("Error sending download message:", chrome.runtime.lastError.message);
            updateStatus(finalStatusSection, `Download Error: ${chrome.runtime.lastError.message}`, null, 'error');
            return; // Early exit
        }

        // Generic response handling that works for both actions
        if (response) {
            switch (response.status) {
                case "download_started": {
                    updateStatus(finalStatusSection, "CSV download started.", null, 'success');
                    break;
                }
                case "image_downloads_initiated": {
                    updateStatus(finalStatusSection, `Started download of ${response.totalToDownload} images...`, null, 'info');
                    break;
                }
                case "no_data": {
                    updateStatus(finalStatusSection, `No data found matching criteria.`, null, 'warning');
                    break;
                }
                case "error": {
                    console.error("Download failed in background:", response.message);
                    updateStatus(finalStatusSection, `Download Error: ${response.message || 'Unknown'}`, null, 'error');
                    break;
                }
                default: {
                    console.warn("Unexpected download response:", response);
                    updateStatus(finalStatusSection, "Download failed (check console).", null, 'error');
                }
            }
        } else {
            updateStatus(finalStatusSection, "No response from background.", null, 'error');
        }

        // Always update status after an attempt, with a short delay
        setTimeout(() => requestAndUpdateState(false), 1500);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Popup received message from background:", message);

    switch (message.action) {
        case "update-status":
            const isUploaderContext = message.source === 'upload';

            // Update the main status message in the correct tab
            if (isUploaderContext) {
                updateStatus('upload', message.status, message.count, 'info');
            } else if (isImaginePage) { // Status for scraper only on the correct page
                updateStatus('scraper', message.status, message.count, 'info');
            }

            // Show the name of the currently downloaded file
            if (message.currentItem && currentFileStatusP && isUploaderContext) {
                currentFileStatusP.textContent = `Current file: ${message.currentItem}`;
                currentFileStatusP.classList.remove('hidden');
            } else if (currentFileStatusP) {
                currentFileStatusP.classList.add('hidden');
            }

            // Update button states
            // 'processedUploadDataInfo' is defined in the popup's scope and safe.
            const uploadHasData = (processedUploadDataInfo && processedUploadDataInfo.totalRows > 0);
            updateButtonStates(message.isRunning, message.hasData, uploadHasData);
            break;

        case "upload_processed_result":
            console.log("Received upload processing result:", message);
            if (message.status === 'success' && message.result) {
                currentDataSource = 'upload';
                processedUploadDataInfo = message.result;

                populateUrlColumnSelect(message.result.headers, message.result.validUrlHeaders);
                populateActionFilters(message.result.actions);

                updateDetailedUploadStatus();
                // When receiving the result of an upload processing, the scraper is not active.
                // The second parameter (scraperHasData) is therefore false (or null).
                updateButtonStates(false, false, (message.result.totalRows || 0) > 0);
            } else {
                updateStatus('upload', `Error: ${message.message || 'Processing failed'}`, 0, 'error');
                resetUploadUI();
            }
            break;
        // More cases for other messages could be added here
    }

    // Important for Chrome Extension Messaging, if sendResponse is used asynchronously
    // (although we don't explicitly use it for all paths here, it's good practice).
    return true;
});


/**
 * Requests the current extension state from the background script and updates the popup UI accordingly.
 *
 * Depending on the response and the `resetStateForUploadTab` flag, updates status messages, upload data info, dropdowns, filters, and button states for both the scraper and uploader tabs. Handles error conditions and ensures the UI reflects the latest available data or resets to a waiting state if necessary.
 *
 * @param {boolean} [resetStateForUploadTab=true] - Whether to reset the upload tab state if no new upload data is received.
 */
async function requestAndUpdateState(resetStateForUploadTab = true) {
    console.log("Requesting current state. Reset upload tab state:", resetStateForUploadTab);

    // First, check if we are on the correct page for the scraper
    await checkActiveTabAndUpdateScraperUI();

    chrome.runtime.sendMessage({ action: "get-status" }, (response) => {
        let isScrapingRunning = false;
        let scraperHasData = false; // Important for scraper button states
        let uploadHasData = false;  // Important for uploader button states

        if (chrome.runtime.lastError) {
            console.error("Error getting background status:", chrome.runtime.lastError.message);
            if (isImaginePage) {
                updateStatus('scraper', `Error: ${chrome.runtime.lastError.message}`, null, 'error');
            }
            // If an error occurs while getting the status and the upload tab should be reset
            // or there is no upload data, reset the upload section.
            if (resetStateForUploadTab || !processedUploadDataInfo) {
                processedUploadDataInfo = null; // Ensure old data is cleared
                updateDetailedUploadStatus(); // Shows "Waiting for upload"
            }
            // Buttons will be updated with default values (false for data/running) at the end
        } else if (response) {
            console.log("Received background state:", response);
            isScrapingRunning = response.isRunning || false;
            scraperHasData = response.hasData || false;

            if (isImaginePage) { // Update scraper status only if on the correct page
                updateStatus('scraper', response.status || "Idle", response.count || 0, 'info');
            }

            // Process upload data from the response
            if (response.uploadData) {
                processedUploadDataInfo = response.uploadData;
                uploadHasData = (processedUploadDataInfo.totalRows || 0) > 0;
                // Populate uploader tab UI elements with new data
                populateUrlColumnSelect(processedUploadDataInfo.headers, processedUploadDataInfo.validUrlHeaders);
                populateActionFilters(processedUploadDataInfo.actions);
                updateDetailedUploadStatus(); // Show detailed upload status
                // When receiving new upload data, the scraper is not active.
                // The second parameter (scraperHasData) is therefore false (or null).
                updateButtonStates(false, false, (response.uploadData.totalRows || 0) > 0);
            } else if (resetStateForUploadTab) {
                // No new upload data from the response AND the tab should be reset
                processedUploadDataInfo = null;
                populateUrlColumnSelect([], []); // Clear dropdowns
                populateActionFilters([]);
                updateDetailedUploadStatus(); // Shows "Waiting for upload"
                uploadHasData = false;
            } else if (processedUploadDataInfo) {
                // No new upload data, do not reset the tab, but there is existing old data
                // -> Refresh the display with the existing old data
                uploadHasData = (processedUploadDataInfo.totalRows || 0) > 0;
                populateUrlColumnSelect(processedUploadDataInfo.headers, processedUploadDataInfo.validUrlHeaders);
                populateActionFilters(processedUploadDataInfo.actions);
                updateDetailedUploadStatus();
            } else {
                // No new upload data, do not reset, and there is no existing data
                processedUploadDataInfo = null; // Ensure it is null
                updateDetailedUploadStatus(); // Shows "Waiting for upload"
                uploadHasData = false;
            }
        } else {
            // No response (response is null/undefined) from the background script
            console.warn("No response received for get-status request.");
            if (isImaginePage) {
                updateStatus('scraper', "Could not get status.", null, 'warning');
            }
            // If the upload tab should be reset or there is no upload data, reset the upload section.
            if (resetStateForUploadTab || !processedUploadDataInfo) {
                processedUploadDataInfo = null;
                updateDetailedUploadStatus(); // Shows "Waiting for upload"
            }
            // isScrapingRunning, scraperHasData, uploadHasData keep their default values (false)
        }

        // Finally, update the states of all buttons based on the gathered information
        updateButtonStates(isScrapingRunning, scraperHasData, uploadHasData);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    showTab('scraper');
    if (urlColumnSelect) {
        urlColumnSelect.addEventListener('change', updateDetailedUploadStatus);
    }
});

/**
 * Populates the URL column dropdown with valid URL header options from uploaded data.
 *
 * If no valid URL columns are found, displays a disabled option indicating this. Otherwise, adds each valid URL header as an option and selects a default, prioritizing 'download_url', then 'url', then the first alphabetically.
 *
 * @param {string[]} allHeaders - All headers detected in the uploaded CSV file.
 * @param {string[]} validUrlHeaders - Headers identified as valid URL columns.
 */
function populateUrlColumnSelect(allHeaders = [], validUrlHeaders = []) {
    if (!urlColumnSelect) return;
    urlColumnSelect.innerHTML = '';

    if (!validUrlHeaders || validUrlHeaders.length === 0) {
        const noUrlOption = document.createElement('option');
        noUrlOption.value = "";
        noUrlOption.textContent = "No valid URL column found";
        noUrlOption.disabled = true;
        urlColumnSelect.appendChild(noUrlOption);
        urlColumnSelect.value = "";
        return;
    }

    validUrlHeaders.forEach(header => {
        if (header && typeof header === 'string') {
            const option = document.createElement('option');
            option.value = header;
            option.textContent = header;
            urlColumnSelect.appendChild(option);
        }
    });

    let defaultSelectedValue = '';
    if (validUrlHeaders.includes('download_url')) {
        defaultSelectedValue = 'download_url';
    } else if (validUrlHeaders.includes('url')) {
        defaultSelectedValue = 'url';
    } else {
        const sortedValidHeaders = [...validUrlHeaders].sort((a, b) => a.localeCompare(b));
        if (sortedValidHeaders.length > 0) {
            defaultSelectedValue = sortedValidHeaders[0];
        }
    }

    if (defaultSelectedValue) {
        urlColumnSelect.value = defaultSelectedValue;
    } else if (urlColumnSelect.options.length > 0) {
        urlColumnSelect.selectedIndex = 0;
    }
}

/**
 * Populates the action filter container with buttons for each available action.
 *
 * Clears existing filters and displays a placeholder if no actions are provided. Each button allows toggling its corresponding action as an active filter.
 *
 * @param {string[]} [actions=[]] - List of action names to create filter buttons for.
 */
function populateActionFilters(actions = []) {
    if (!actionFilterContainer) return;
    actionFilterContainer.innerHTML = '';
    activeActionFilters.clear();

    if (!actions || actions.length === 0) {
        actionFilterContainer.innerHTML = '<span class="no-filters-placeholder">No actions found in data.</span>';
        return;
    }

    actions.sort().forEach(action => {
        const button = document.createElement('button');
        button.textContent = action;
        button.classList.add('action-filter-button');
        button.dataset.action = action;
        button.title = `Filter by action: ${action}`;
        button.addEventListener('click', handleActionFilterToggle);
        actionFilterContainer.appendChild(button);
    });
}

/**
 * Toggles the active state of an action filter button and updates the set of active action filters.
 *
 * @param {Event} event - The click event from an action filter button.
 *
 * @remark
 * This function does not trigger immediate filtering or status updates; filters are applied when downloading.
 */
function handleActionFilterToggle(event) {
    const button = event.target;
    const action = button.dataset.action;
    if (!action) return;

    button.classList.toggle('active');

    if (button.classList.contains('active')) {
        activeActionFilters.add(action);
    } else {
        activeActionFilters.delete(action);
    }
    console.log(`Active action filters: [${Array.from(activeActionFilters).join(', ')}]`);
    // No immediate re-filtering or status update here; filters apply at download time.
}