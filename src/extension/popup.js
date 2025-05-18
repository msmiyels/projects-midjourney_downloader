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

// --- State Variables ---
let currentDataSource = 'none'; // 'scraper', 'upload', or 'none'
let activeTabId = 'scraper';    // 'scraper' or 'downloader'
let processedUploadDataInfo = null; // Will hold { headers, validUrlHeaders, urlCountsPerColumn, totalRows, actions, count }
let activeActionFilters = new Set();
let isImaginePage = false;

// --- Helper Functions ---

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


        if(shouldBeVisible) {
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

// NEUE/ÜBERARBEITETE Funktion in popup.js:
function updateDetailedUploadStatus() {
    if (!statusUploadDiv) return; // Sicherstellen, dass das Status-Div existiert
    
    // Standardmäßig Filter ausblenden, werden nur bei expliziter Bedingung unten wieder eingeblendet
    if (uploadFiltersDiv) uploadFiltersDiv.classList.add('hidden');

    if (!processedUploadDataInfo || !processedUploadDataInfo.headers) {
        updateStatus('upload', "Waiting for upload", 0, 'info');
        return;
    }

    const totalRowCount = processedUploadDataInfo.totalRows || 0;
    const hasHeaders = processedUploadDataInfo.headers && processedUploadDataInfo.headers.length > 0;
    const hasValidUrlCols = processedUploadDataInfo.validUrlHeaders && processedUploadDataInfo.validUrlHeaders.length > 0;
    let statusMsg = "";
    let statusType = 'info'; // Standardtyp
    let showFilters = false; // Standardmäßig Filter nicht anzeigen

    if (totalRowCount > 0 && !hasValidUrlCols) {
        // Fall 1: Daten vorhanden, aber keine validen URL-Spalten -> Hauptwarnung
        statusMsg = "No valid download URL found.";
        statusType = 'warning';
        // Filter bleiben versteckt (Standard von oben)
    } else if (totalRowCount === 0) {
        // Fall 2: Keine Datenzeilen verarbeitet
        if (hasHeaders) { // CSV hatte Header, aber keine Datenzeilen
            statusMsg = "Processed: No data rows found.";
        } else { // Keine Header, keine Daten (z.B. komplett leere Datei oder vor dem ersten Upload)
            statusMsg = "Waiting for upload";
        }
        // Filter bleiben versteckt
    } else if (totalRowCount > 0 && hasValidUrlCols) {
        // Fall 3: Daten vorhanden UND valide URL-Spalten vorhanden
        const selectedColumn = urlColumnSelect ? urlColumnSelect.value : null;
        
        // Prüfen, ob eine valide Spalte ausgewählt ist (nicht die "No valid URL column found"-Option)
        const isColumnSelectedAndValid = selectedColumn && 
                                     urlColumnSelect.selectedIndex !== -1 && 
                                     !urlColumnSelect.options[urlColumnSelect.selectedIndex]?.disabled;

        if (isColumnSelectedAndValid && processedUploadDataInfo.urlCountsPerColumn) {
            const validUrlCountInSelectedColumn = processedUploadDataInfo.urlCountsPerColumn[selectedColumn] || 0;

            if (validUrlCountInSelectedColumn < totalRowCount) {
                // Nicht alle Einträge in der ausgewählten Spalte sind gültig
                statusMsg = `${validUrlCountInSelectedColumn} von ${totalRowCount} Einträgen gültig.`;
                statusType = 'partial-info'; // Neue subtile Hervorhebungsklasse verwenden
            } else { 
                // Alle Einträge in der ausgewählten Spalte sind gültig
                statusMsg = "Daten verarbeitet"; // Info über Gültigkeit wird "weggelassen", stattdessen generischer Status
                statusType = 'info'; // Oder 'success', falls gewünscht
            }
            showFilters = true; // Filter können angezeigt werden
        } else if (hasValidUrlCols) { 
            // Valide Spalten sind da, aber vielleicht noch keine explizit ausgewählt oder die Auswahl ist die Platzhalter-Option.
            // Dies sollte durch die Vorauswahl in populateUrlColumnSelect meist zu einem validen `selectedColumn` führen.
            // Wenn nicht, eine neutrale Aufforderung.
            statusMsg = "Bitte URL-Spalte auswählen."; 
            statusType = 'info';
            showFilters = true; // Filter anzeigen, da valide Optionen existieren
        } else {
            // Sollte nicht erreicht werden, wenn hasValidUrlCols true ist. Sicherheits-Fallback.
            statusMsg = "Daten verarbeitet";
            statusType = 'info';
        }
    } else {
        // Allgemeiner Fallback, z.B. wenn processedUploadDataInfo existiert, aber totalRowCount 0 ist und keine Header (unwahrscheinlich)
        statusMsg = "Waiting for upload";
        // Filter bleiben versteckt
    }

    updateStatus('upload', statusMsg, totalRowCount, statusType);
    
    // Filter ein-/ausblenden basierend auf der showFilters-Variable
    if (uploadFiltersDiv) {
        if (showFilters) {
            uploadFiltersDiv.classList.remove('hidden');
        } else {
            uploadFiltersDiv.classList.add('hidden');
        }
    }
}


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

function updateButtonStates(isScrapingRunning, scraperHasData = null, uploadDataHasRows = null) {
    // uploadDataHasRows ist true, wenn processedUploadDataInfo.totalRows > 0

    if (startButton) startButton.disabled = !isImaginePage || isScrapingRunning;
    if (stopButton) stopButton.disabled = !isImaginePage || !isScrapingRunning;
    if (uploadButton) uploadButton.disabled = isScrapingRunning;

    let canDownload = false;
    let selectedColumnHasMinOneValidEntry = false; // Für Downloader-spezifische Prüfung
    const overallValidUrlColumnsExist = processedUploadDataInfo?.validUrlHeaders?.length > 0;

    if (!isScrapingRunning) {
        if (activeTabId === 'downloader') {
            // Bedingungen für Download im Downloader-Tab:
            // 1. CSV wurde verarbeitet und hat Zeilen (uploadDataHasRows).
            // 2. Es gibt überhaupt als valide erkannte URL-Spalten im CSV (overallValidUrlColumnsExist).
            // 3. Die aktuell ausgewählte Spalte hat mindestens einen gültigen URL-Eintrag.
            if (uploadDataHasRows && overallValidUrlColumnsExist && urlColumnSelect && processedUploadDataInfo?.urlCountsPerColumn) {
                const selectedColumn = urlColumnSelect.value;
                // Ist die ausgewählte Spalte nicht die "No valid..."-Option und hat sie Einträge?
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
        } else if (activeTabId === 'scraper') {
            // Bedingung für Download im Scraper-Tab:
            if (scraperHasData === true) {
                canDownload = true;
            }
        }
    }

    if (downloadCsvButton) {
        downloadCsvButton.disabled = !canDownload;
        // Text basierend auf dem aktiven Tab setzen
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

    chrome.runtime.sendMessage({ action: "download-csv", options: downloadOptions }, (response) => {
        const finalStatusSection = downloadOptions.source === 'upload' ? 'upload' : 'scraper';
        if (chrome.runtime.lastError) {
            console.error("Error sending download message:", chrome.runtime.lastError.message);
            updateStatus(finalStatusSection, `Download Error: ${chrome.runtime.lastError.message}`, null, 'error');
        } else if (response && response.status === "download_started") {
            updateStatus(finalStatusSection, "Download initiated.", null, 'success');
        } else if (response && response.status === "error") {
            console.error("Download failed in background:", response.message);
            updateStatus(finalStatusSection, `Download Error: ${response.message || 'Unknown'}`, null, 'error');
        } else if (response && response.status === "no_data") {
            updateStatus(finalStatusSection, "No data found matching criteria.", null, 'warning');
        } else {
            console.warn("Unexpected download response:", response);
            updateStatus(finalStatusSection, "Download failed (check console).", null, 'error');
        }
        // Always refresh state after a download attempt, after a short delay for user to see status
        setTimeout(() => requestAndUpdateState(false), 1500);
    });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Popup received message from background:", message);

    switch(message.action) {
        case "update-status":
             const isScrapingSource = message.source !== 'upload';
             if (isScrapingSource) { // Nachricht kommt vom Scraper oder ist allgemein
                 if (isImaginePage) {
                    updateStatus('scraper', message.status || "Unknown", message.count, 'info');
                 }
                 // Aktualisiere Button-Zustände basierend auf Scraper-Infos.
                 // processedUploadDataInfo?.totalRows > 0 prüft, ob Upload-Daten für den dritten Parameter vorhanden sind.
                 updateButtonStates(message.isRunning, message.hasData, (processedUploadDataInfo?.totalRows || 0) > 0);
             } else { // message.source === 'upload'
                // Wenn eine generische "update-status"-Nachricht für "upload" kommt,
                // ist es am sichersten, den gesamten UI-Status neu abzurufen und zu rendern,
                // da wir den aktuellen Scraper-Status für updateButtonStates benötigen und
                // diese generische Nachricht möglicherweise nicht alle Detailinfos für den Upload-Status enthält.
                console.log("Received generic 'upload' status update, initiating full state refresh.");
                requestAndUpdateState(false); // `false` um den Upload-Tab nicht unnötig zurückzusetzen, wenn er bereits Daten hat
             }
            break;

        case "upload_processed_result":
            console.log("Received upload processing result:", message);
            if (message.status === 'success' && message.result) {
                 currentDataSource = 'upload';
                 processedUploadDataInfo = message.result;

                 populateUrlColumnSelect(message.result.headers, message.result.validUrlHeaders);
                 populateActionFilters(message.result.actions);

                 updateDetailedUploadStatus();
                 // Beim Ergebnis einer Upload-Verarbeitung ist der Scraper nicht aktiv.
                 // Der zweite Parameter (scraperHasData) ist daher false (oder null).
                 updateButtonStates(false, false, (message.result.totalRows || 0) > 0);
             } else {
                 updateStatus('upload', `Error: ${message.message || 'Processing failed'}`, 0, 'error');
                 resetUploadUI();
             }
             break;
        // Hier könnten später weitere Cases für andere Nachrichten hinzukommen
    }

    // Wichtig für Chrome Extension Messaging, wenn sendResponse asynchron verwendet werden KÖNNTE
    // (obwohl wir es hier nicht explizit für alle Pfade tun, ist es eine gute Praxis).
    return true;
});


async function requestAndUpdateState(resetStateForUploadTab = true) {
    console.log("Requesting current state. Reset upload tab state:", resetStateForUploadTab);
    
    // Zuerst prüfen, ob wir auf der korrekten Seite für den Scraper sind
    await checkActiveTabAndUpdateScraperUI(); 

    chrome.runtime.sendMessage({ action: "get-status" }, (response) => {
        let isScrapingRunning = false;
        let scraperHasData = false; // Wichtig für den Status der Scraper-Buttons
        let uploadHasData = false;  // Wichtig für den Status der Uploader-Buttons

        if (chrome.runtime.lastError) {
            console.error("Error getting background status:", chrome.runtime.lastError.message);
            if (isImaginePage) {
                updateStatus('scraper', `Error: ${chrome.runtime.lastError.message}`, null, 'error');
            }
            // Wenn ein Fehler beim Abrufen des Status auftritt und der Upload-Tab zurückgesetzt werden soll
            // oder keine Upload-Daten vorhanden sind, den Upload-Bereich zurücksetzen/aktualisieren.
            if (resetStateForUploadTab || !processedUploadDataInfo) { 
                 processedUploadDataInfo = null; // Sicherstellen, dass alte Daten gelöscht werden
                 updateDetailedUploadStatus(); // Zeigt "Waiting for upload" oder leeren Zustand
            }
            // Buttons werden am Ende mit Standardwerten (false für Daten/Laufzeit) aktualisiert
        } else if (response) {
            console.log("Received background state:", response);
            isScrapingRunning = response.isRunning || false;
            scraperHasData = response.hasData || false; 

            if (isImaginePage) { // Scraper-Status nur aktualisieren, wenn auf der korrekten Seite
                updateStatus('scraper', response.status || "Idle", response.count || 0, 'info');
            }
            
            // Upload-Daten aus der Antwort verarbeiten
            if (response.uploadData) {
                 processedUploadDataInfo = response.uploadData; 
                 uploadHasData = (processedUploadDataInfo.totalRows || 0) > 0;
                 // UI-Elemente für den Uploader-Tab mit den neuen Daten füllen
                 populateUrlColumnSelect(processedUploadDataInfo.headers, processedUploadDataInfo.validUrlHeaders);
                 populateActionFilters(processedUploadDataInfo.actions);
                 updateDetailedUploadStatus(); // Detaillierten Upload-Status anzeigen
            } else if (resetStateForUploadTab) { 
                 // Keine neuen Upload-Daten von der Antwort UND der Tab soll zurückgesetzt werden
                 processedUploadDataInfo = null; 
                 populateUrlColumnSelect([], []); // Dropdowns leeren
                 populateActionFilters([]);
                 updateDetailedUploadStatus(); // Zeigt "Waiting for upload"
                 uploadHasData = false;
            } else if (processedUploadDataInfo) { 
                // Keine neuen Upload-Daten, Tab nicht explizit zurücksetzen, aber es existieren alte Daten
                // -> Anzeige mit den vorhandenen alten Daten auffrischen
                uploadHasData = (processedUploadDataInfo.totalRows || 0) > 0;
                populateUrlColumnSelect(processedUploadDataInfo.headers, processedUploadDataInfo.validUrlHeaders);
                populateActionFilters(processedUploadDataInfo.actions);
                updateDetailedUploadStatus(); 
            } else { 
                 // Keine neuen Upload-Daten, nicht zurücksetzen, und auch keine alten Daten vorhanden
                 processedUploadDataInfo = null; // Sicherstellen, dass es null ist
                 updateDetailedUploadStatus(); // Zeigt "Waiting for upload"
                 uploadHasData = false;
            }
        } else { 
            // Keine Antwort (response ist null/undefined) vom Background-Skript
            console.warn("No response received for get-status request.");
            if (isImaginePage) {
                updateStatus('scraper', "Could not get status.", null, 'warning');
            }
            // Wenn resetStateForUploadTab true ist oder keine Upload-Daten existieren, Upload-Bereich zurücksetzen
            if (resetStateForUploadTab || !processedUploadDataInfo) {
                 processedUploadDataInfo = null;
                 updateDetailedUploadStatus(); // Zeigt "Waiting for upload"
            }
            // isScrapingRunning, scraperHasData, uploadHasData behalten ihre Default-Werte (false)
        }
        
        // Abschließend die Zustände aller Buttons basierend auf den gesammelten Informationen aktualisieren
        updateButtonStates(isScrapingRunning, scraperHasData, uploadHasData);
    });
}

document.addEventListener('DOMContentLoaded', () => { 
    showTab('scraper'); 
    if (urlColumnSelect) {
        urlColumnSelect.addEventListener('change', updateDetailedUploadStatus);
    }
});

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