/*
     @fileoverview Main script handling UI interactions and data processing
     for different HTML pages (get_images.html, file_download.html),
     now including enhanced URL selection and download filtering options.
*/

/*
     Configuration constants for the script.
     @const
*/
const Config = {
  /* @const {number} Delay in milliseconds between download operations.*/
  DOWNLOAD_DELAY_MS: 200,
  /* @const {string} CSV column name used for data deduplication.*/
  DEDUPLICATION_COLUMN_NAME: 'url',
  /* @const {string} CSV column name for the image download source URL (can be generated).*/
  IMAGE_DOWNLOAD_SOURCE_COLUMN: 'download_url',
  /* @const {string} Optional CSV column name for image prompts.*/
  OPTIONAL_PROMPT_COLUMN_NAME: 'prompt',
  /* @const {string} CSV column name for the job ID.*/
  JOB_ID_COLUMN_NAME: 'job_id',
  /* @const {string} CSV column name for the extracted action keyword.*/
  ACTION_COLUMN_NAME: 'action',
  /* @const {number} How many rows to check for http prefix when detecting URL columns */
  URL_SCAN_ROW_LIMIT: 20,
  /* @const {number} Min percentage of scanned rows that must look like URLs to be considered a URL column */
  URL_SCAN_MIN_PERCENTAGE: 0.5
};

// ---- Common Utility Functions ----

/*
     Creates a promise that resolves after a specified delay.
     @param {number} ms The delay in milliseconds.
     @returns {Promise<void>} A promise that resolves after the delay.
*/
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/*
     Gets the current date formatted as-MM-DD.
     @returns {string} The formatted date string.
*/
function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/*
     Escapes a value for safe inclusion in a CSV cell.
     Handles quotes, commas, and newlines.
     @param {*} value The value to escape.
     @returns {string} The escaped CSV value. Returns empty string "" for null/undefined.
*/
function escapeCsvValue(value) {
  if (value === null || typeof value === 'undefined') {
    return ''; // Represent null/undefined as empty non-quoted string
  }
  let stringValue = String(value);
  // If the value contains a double quote, comma, newline, or carriage return,
  // escape double quotes by doubling them and enclose the whole value in double quotes.
  if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('\r')) {
    stringValue = stringValue.replace(/"/g, '""'); // Escape existing double quotes
    stringValue = `"${stringValue}"`; // Enclose in double quotes
  }
  return stringValue;
}

/*
    Generates a CSV string from an array of objects and headers.
    Ensures all specified headers are included, even if not present in all objects.
    Adds IMAGE_DOWNLOAD_SOURCE_COLUMN header if it exists in data but not headers.
    @param {Array<Object>} dataArray The array of data objects.
    @param {Array<string>} headers An array of header strings (typically originalHeaders).
    @returns {string} The generated CSV string (including BOM).
*/
function generateCsvString(dataArray, headers) {
  if (!dataArray || dataArray.length === 0) return '';

  const finalHeaders = [...headers]; // Use provided headers as base (maintains original order)

  // Check if download_url was potentially generated and needs its header added
  const hasGeneratedDownloadUrl = dataArray.some(item => item.hasOwnProperty(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN));
  if (hasGeneratedDownloadUrl && !finalHeaders.includes(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN)) {
      // Add it if it exists in data but wasn't in original headers
      // Try to insert after the original URL column, otherwise append
      const urlIndex = finalHeaders.findIndex(h => h === Config.DEDUPLICATION_COLUMN_NAME);
      if (urlIndex > -1) {
          finalHeaders.splice(urlIndex + 1, 0, Config.IMAGE_DOWNLOAD_SOURCE_COLUMN);
      } else {
           finalHeaders.push(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN); // Add at end if original url not found
      }
      console.log("DEBUG: Added potentially generated download_url header for CSV export.");
  }

  const headerRow = finalHeaders.map(escapeCsvValue).join(',');
  const dataRows = dataArray.map(row => {
    // For each row, map based on the finalHeaders array
    return finalHeaders.map(header => {
      // Get the value from the row object using the header; default to empty if missing
      const value = row.hasOwnProperty(header) ? row[header] : '';
      return escapeCsvValue(value); // Escape the value
    }).join(',');
  });

  // Prepend BOM for better Excel compatibility
  return `\uFEFF${[headerRow, ...dataRows].join('\n')}`;
}

/*
    Triggers a browser download for the given content.
    @param {string} content The content to download.
    @param {string} filename The desired filename for the download.
    @param {string} [contentType='text/csv;charset=utf-8;'] The MIME type of the content.
*/
function downloadFile(content, filename, contentType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: contentType });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url); // Clean up the object URL
}

/*
    Parses a single line of CSV text, respecting quoted fields.
    Handles double quotes ("") within quoted fields.
    @param {string} line The CSV line to parse.
    @returns {Array<string>} An array of parsed values.
*/
function parseCsvLine(line) {
  const values = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Handle escaped double quote ("") inside quoted field
        currentVal += '"';
        i++; // Skip the next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of a value (if not inside quotes)
      values.push(currentVal); // Store value before reset
      currentVal = ''; // Reset for next value
    } else {
      // Append character to current value
      currentVal += char;
    }
  }

  values.push(currentVal); // Add the last value

  // Post-process each value: remove surrounding quotes ONLY if they were the delimiters, and unescape "" -> "
  return values.map(val => {
      let finalVal = val.trim(); // Trim whitespace first
      // Check if the value started and ended with quotes (as delimiters)
      if (finalVal.length >= 2 && finalVal.startsWith('"') && finalVal.endsWith('"')) {
           // Remove the outer quotes ONLY if they were part of the CSV quoting mechanism
           // This check might be too simple if a field legitimately starts/ends with a quote AND contains commas etc.
           // A more robust CSV parser might be needed for complex edge cases.
           // For now, we assume outer quotes were delimiters if present.
           finalVal = finalVal.substring(1, finalVal.length - 1);
      }
      // Replace escaped double quotes ("") with single double quotes (")
      return finalVal.replace(/""/g, '"');
  });
}


/*
    Deduplicates an array of objects based on a specified key.
    Keeps the first occurrence of each unique key value. Logs skipped items.
    @param {Array<Object>} dataArray The array of objects to deduplicate.
    @param {string} key The property name to use as the deduplication key.
    @returns {Array<Object>} A new array containing only unique items.
*/
function deduplicateData(dataArray, key) {
  const uniqueMap = new Map();
  let skippedCount = 0;
  dataArray.forEach((item, index) => {
    if (item && typeof item === 'object' && item.hasOwnProperty(key) && item[key] /* Ensure key has a truthy value */) {
         if (!uniqueMap.has(item[key])) {
             uniqueMap.set(item[key], item);
         } else {
             // Log skipped duplicates for debugging if needed
             // console.log(`DEBUG: Skipping duplicate row ${index + 2} (based on '${key}'): ${item[key]}`);
             skippedCount++;
         }
    } else {
      console.warn(`Skipping invalid item or item with missing/empty key '${key}' during deduplication (row ${index + 2}):`, item);
      skippedCount++;
    }
  });
  const uniqueData = Array.from(uniqueMap.values());
  console.log(`DEBUG: Deduplication based on key '${key}'. Started with ${dataArray.length} data rows, ended with ${uniqueData.length} unique items. Skipped ${skippedCount} rows (invalid key or duplicate).`);
  return uniqueData;
}

/*
    Extracts or generates a simplified download URL from a given source URL.
    Attempts to construct a URL ending in the first 3 chars of the filename + extension.
    @param {string|null} url The source URL string.
    @returns {string|null} The extracted/generated download URL, or null if parsing fails.
*/
function extractDownloadUrlJS(url) {
    if (!url || typeof url !== 'string') return null;
    try {
        const urlWithoutQuery = url.split('?')[0];
        const parts = urlWithoutQuery.split('/');
        if (parts.length < 2) return null; // Need at least domain/filename

        const filenameWithExt = parts[parts.length - 1];
        const filenameParts = filenameWithExt.split('.');
        if (filenameParts.length < 2) return null; // Need filename and extension

        const filename = filenameParts[0];
        const suffix = '.' + filenameParts[filenameParts.length - 1];

        // Specific logic: use first 3 chars + suffix
        if (filename.length < 3) return null;
        const first3 = filename.substring(0, 3);
        const newFilename = first3 + suffix;

        const basePath = urlWithoutQuery.substring(0, urlWithoutQuery.lastIndexOf('/'));
        let finalUrl = `${basePath}/${newFilename}`;

        // Attempt to prepend origin if basePath seems relative, handle potential errors
        try {
            const originalUrlObj = new URL(url); // Use original URL to check/get origin
            if (!basePath.startsWith('http') && originalUrlObj.origin && originalUrlObj.origin !== 'null') {
                // Construct carefully to avoid double slashes if basePath starts with /
                finalUrl = `${originalUrlObj.origin}${basePath.startsWith('/') ? '' : '/'}${basePath.replace(/^\//,'')}/${newFilename}`;
            }
        } catch(urlError){
            // This might happen if the original URL itself was invalid or relative
            console.warn("Could not parse original URL to get origin, using potentially relative path.", urlError);
        }
        return finalUrl;

    } catch (e) {
        console.error(`Error parsing URL for download_url generation: ${url}`, e);
        return null; // Return null on any error during processing
    }
}


// ---- Main Logic ----
document.addEventListener('DOMContentLoaded', () => {
  console.log("DOM loaded. Initializing specific page logic...");

  // Get references to common DOM elements that might exist on any page
  const csvFileInput = document.getElementById('csvFileInput');
  const statusDiv = document.getElementById('status');
  const statusWrapper = document.getElementById('statusWrapper');
  const manualUploadTrigger = document.getElementById('manualUploadTrigger');
  const dropZoneTarget = document.getElementById('dropZoneTarget');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const controlsDiv = document.getElementById('controls');
  const processButton = document.getElementById('processButton');
  const saveCsvButton = document.getElementById('saveCsvButton');

  // --- Logic for get_images.html (Code Snippet Modal) ---
  const showManualCodeBtn = document.getElementById('showManualCodeBtn');
  const showAutoCodeBtn = document.getElementById('showAutoCodeBtn');
  if (showManualCodeBtn && showAutoCodeBtn) {
    console.log("Initializing logic for get_images.html (Code Snippet Modal)");

    // Get modal DOM elements
    const codeModal = document.getElementById('codeModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const modalTitle = document.getElementById('modalTitle');
    const modalCodeContent = document.getElementById('modalCodeContent');
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    const modalError = document.getElementById('modalError');
    const copyButtonTextSpan = copyCodeBtn?.querySelector('.copy-button-text');

    /* Resets the copy button text and enabled state.*/
    function resetCopyButtonState() {
      if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Copy';
      // Enable button only if there's content to copy
      if (copyCodeBtn) copyCodeBtn.disabled = !modalCodeContent || !modalCodeContent.textContent || modalCodeContent.textContent === 'Loading code...';
    }

    /* Fetches code from a script path and displays it in the modal. */
    async function showCodeModal(buttonElement) {
      const scriptPath = buttonElement.dataset.scriptPath;
      const title = buttonElement.dataset.title || 'Code Snippet';

      modalTitle.textContent = title;
      modalCodeContent.textContent = 'Loading code...'; // Placeholder
      modalError.style.display = 'none';
      modalError.textContent = '';
      resetCopyButtonState(); // Reset state initially
      if (copyCodeBtn) copyCodeBtn.disabled = true; // Disable while loading
      codeModal.style.display = 'block';

      try {
        console.log(`Workspaceing code from: ${scriptPath}`);
        const response = await fetch(scriptPath);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        const codeText = await response.text();
        modalCodeContent.textContent = codeText; // Display fetched code
        if (copyCodeBtn) copyCodeBtn.disabled = !codeText; // Enable copy button only if code loaded
        console.log(`Successfully loaded code from ${scriptPath}`);
      } catch (error) {
        console.error('Error loading script content:', error);
        modalCodeContent.textContent = ''; // Clear loading text on error
        modalError.textContent = `Error loading code from "${scriptPath}": ${error.message}. Check path and server.`;
        modalError.style.display = 'block';
        if (copyCodeBtn) copyCodeBtn.disabled = true;
      }
    }

    /* Hides the code modal and resets its content.*/
    function hideCodeModal() {
      if (codeModal) {
        codeModal.style.display = 'none';
        modalCodeContent.textContent = ''; // Clear content
        modalError.style.display = 'none';
        resetCopyButtonState(); // Reset button
      }
    }

    /* Copies the code content from the modal to the clipboard.*/
    async function copyCodeToClipboard() {
      const codeToCopy = modalCodeContent.textContent;
      // Check if clipboard API is available and there's code to copy
      if (!navigator.clipboard || !codeToCopy || codeToCopy === 'Loading code...') {
        console.warn('Clipboard API not available or no code content to copy.');
        if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Error';
        setTimeout(resetCopyButtonState, 2000);
        return;
      }

      if (copyCodeBtn) copyCodeBtn.disabled = true; // Prevent double-clicks during async operation

      try {
        await navigator.clipboard.writeText(codeToCopy);
        if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Copied!';
        console.log('Code copied to clipboard.');
        setTimeout(() => {
          resetCopyButtonState(); // Re-enables the button after delay
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code to clipboard:', err);
        if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Error';
        modalError.textContent = 'Copying to clipboard failed.';
        modalError.style.display = 'block';
        setTimeout(() => {
          resetCopyButtonState(); // Re-enables the button after delay
          modalError.style.display = 'none';
        }, 3000);
      }
    }

    // Event Listeners for Modal
    showManualCodeBtn.addEventListener('click', () => showCodeModal(showManualCodeBtn));
    showAutoCodeBtn.addEventListener('click', () => showCodeModal(showAutoCodeBtn));
    if (closeModalBtn) closeModalBtn.addEventListener('click', hideCodeModal);
    if (copyCodeBtn) copyCodeBtn.addEventListener('click', copyCodeToClipboard);
    if (codeModal) {
        codeModal.addEventListener('click', (event) => {
            if (event.target === codeModal) { hideCodeModal(); } // Click outside content closes modal
        });
    }
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && codeModal && codeModal.style.display === 'block') { hideCodeModal(); } // Escape key closes modal
    });

  }
  // --- Logic for file_download.html (Downloader) ---
  else if (processButton && saveCsvButton) {
    console.log("Initializing logic for file_download.html (Downloader with Enhanced Filters)");

    // Get specific DOM elements for downloader page
    const pauseResumeButton = document.getElementById('pauseResumeButton');
    const stopButton = document.getElementById('stopButton');
    const downloadProgress = document.getElementById('downloadProgress');
    const progressText = document.getElementById('progressText');
    const progressContainer = document.getElementById('progressContainer');
    const imagePreviewContainer = document.getElementById('imagePreviewContainer');
    const imagePreviewPlaceholder = document.getElementById('imagePreviewPlaceholder');
    const previewAreaTitle = document.getElementById('previewAreaTitle');
    const mainContentArea = document.getElementById('mainContentArea');
    const promptDisplayArea = document.getElementById('promptDisplayArea');
    const filterControlsDiv = document.querySelector('.filter-controls');
    const urlColumnSelect = document.getElementById('urlColumnSelect');
    const rowLimitInput = document.getElementById('rowLimitInput');
    const actionFilterContainer = document.getElementById('actionFilterContainer');

    // State variables for the downloader
    let selectedFile = null;
    let fileContent = null;
    let csvHeaders = [];
    let originalHeaders = []; // Headers exactly as found in the file
    let imageData = []; // Holds the processed (deduplicated, urls added) data
    let availableActions = new Set(); // Stores unique action keywords found in data
    let activeActionFilters = new Set(); // Stores currently selected action keywords for filtering
    let isPaused = false;
    let isStopped = false;
    let currentDownloadLoopIndex = 0; // Tracks the index being processed in the loop
    let successCount = 0;
    let errorCount = 0;

    /*
        Updates the status log area with a timestamped message.
        @param {string} message The message to display.
        @param {'info'|'success'|'warning'|'error'} [type='info'] The type of message (affects styling).
    */
    function updateStatus(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const logEntry = document.createElement('div');
      logEntry.textContent = `[${timestamp}] ${message}`;
      logEntry.classList.add('log-entry', type);
      if (statusDiv) {
        if (statusWrapper && statusWrapper.classList.contains('hidden')) {
             statusWrapper.classList.remove('hidden');
             // Clear previous messages only when first shown in a session
             // statusDiv.innerHTML = '';
        }
        statusDiv.insertBefore(logEntry, statusDiv.firstChild); // Prepend new entry
      } else { console.error("Downloader Page: Status Div element not found!"); }
      // Also log to browser console
      console.log(`[DOWNLOADER - ${type.toUpperCase()}] ${message}`);
    }

    /*
        Resets the UI to its initial state before a new file is processed.
        Clears state variables, hides/disables controls, resets progress and previews.
    */
    function resetUIBeforeNewFile() {
      selectedFile = null; fileContent = null; csvHeaders = []; imageData = [];
      originalHeaders = []; availableActions = new Set(); activeActionFilters = new Set();
      isPaused = false; isStopped = false; currentDownloadLoopIndex = 0; successCount = 0; errorCount = 0;

      if (fileNameDisplay) fileNameDisplay.textContent = '';
      if (controlsDiv) controlsDiv.classList.add('hidden');
      if (filterControlsDiv) filterControlsDiv.classList.add('hidden');
      if (processButton) { processButton.classList.add('hidden'); processButton.disabled = true; processButton.textContent = 'Start Download'; }
      if (saveCsvButton) { saveCsvButton.classList.add('hidden'); saveCsvButton.disabled = true; }
      if (mainContentArea) mainContentArea.classList.add('hidden');
      if (previewAreaTitle) previewAreaTitle.classList.add('hidden');
      if (promptDisplayArea) promptDisplayArea.textContent = 'Upload an original CSV file.';
      if (progressContainer) progressContainer.classList.add('hidden');
      if (pauseResumeButton) { pauseResumeButton.classList.add('hidden'); pauseResumeButton.textContent = 'Pause'; pauseResumeButton.disabled = false; }
      if (stopButton) { stopButton.classList.add('hidden'); stopButton.disabled = false; }
      if (imagePreviewContainer) imagePreviewContainer.style.backgroundImage = 'none';
      if (imagePreviewPlaceholder) { imagePreviewPlaceholder.textContent = "No image preview available."; imagePreviewPlaceholder.classList.remove('hidden'); }
      if (downloadProgress) { downloadProgress.value = 0; downloadProgress.removeAttribute('max'); } // Clear max attribute too
      if (progressText) progressText.textContent = '';
      if (statusWrapper) statusWrapper.classList.add('hidden');
      if (statusDiv) statusDiv.innerHTML = ''; // Clear status messages
      if (csvFileInput) csvFileInput.value = null; // Reset file input visually
      // Reset filter elements
      if (urlColumnSelect) urlColumnSelect.innerHTML = '<option value="" disabled selected>Processing file...</option>';
      if (rowLimitInput) rowLimitInput.value = '';
      if (actionFilterContainer) actionFilterContainer.innerHTML = '';
      console.log("DEBUG: UI reset for downloader page executed.");
    }

    /*
        Resets UI elements after a download process finishes or is stopped.
        Hides progress/pause/stop buttons. Keeps 'Save Cleaned CSV' active. Re-enables filters.
    */
    function resetUIDownloadFinished() {
        if(processButton){ processButton.classList.add('hidden'); processButton.disabled = true; processButton.textContent = 'Start Download'; }
        // Keep Save button active after stop/finish if there's data
        if(saveCsvButton){
             if (imageData.length > 0) { saveCsvButton.classList.remove('hidden'); saveCsvButton.disabled = false; }
             else { saveCsvButton.classList.add('hidden'); saveCsvButton.disabled = true; }
        }
        if(pauseResumeButton) { pauseResumeButton.classList.add('hidden'); pauseResumeButton.disabled = false; pauseResumeButton.textContent = 'Pause'; }
        if(stopButton) { stopButton.classList.add('hidden'); stopButton.disabled = false; }
        // Update preview/prompt area messages
        if (imagePreviewContainer) { imagePreviewContainer.style.backgroundImage = 'none'; }
        if (imagePreviewPlaceholder) { imagePreviewPlaceholder.textContent = isStopped ? "Download stopped." : "Action completed."; imagePreviewPlaceholder.classList.remove('hidden'); }
        if (promptDisplayArea) { promptDisplayArea.textContent = isStopped ? 'Download stopped.' : 'Action completed.'; }
        // Re-enable filter controls
        if(filterControlsDiv) {
             filterControlsDiv.querySelectorAll('select, input, button').forEach(el => {
                 // Re-enable only if it wasn't already disabled (e.g., URL select if no options found)
                 if (!el.dataset.initiallyDisabled) {
                     el.disabled = false;
                 }
             });
        }
        console.log("DEBUG: UI reset after action finished/stopped executed. isStopped:", isStopped);
    }

    /*
        Populates the URL column selection dropdown based on data content.
        Detects columns containing URLs by scanning initial rows. Includes "Auto" option.
        @param {Array<string>} headers The array of header strings.
        @param {Array<Object>} data The parsed data array (used for content scanning).
    */
    function populateUrlColumnSelect(headers, data) {
        const potentialUrlColumns = new Set();
        if (!urlColumnSelect) { console.error("DEBUG: urlColumnSelect element not found!"); return; }
        urlColumnSelect.innerHTML = ''; // Clear previous options

        // 1. Add "Auto" Option
        const autoOption = document.createElement('option');
        autoOption.value = "_auto_";
        autoOption.textContent = `auto`;
        urlColumnSelect.appendChild(autoOption);

        // 2. Scan columns based on content
        const rowsToScan = Math.min(data.length, Config.URL_SCAN_ROW_LIMIT);
        console.log(`DEBUG: Scanning up to ${rowsToScan} rows for URL columns.`);
        if (rowsToScan > 0) {
            headers.forEach((header, headerIndex) => {
                // Skip empty/invalid headers
                if (!header || typeof header !== 'string' || header.trim() === '') return;

                let httpCount = 0;
                for (let i = 0; i < rowsToScan; i++) {
                    // Check if row and header property exist
                    if (data[i] && data[i].hasOwnProperty(header)) {
                        const value = data[i][header];
                        // Check if value is a string starting with http
                        if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
                            httpCount++;
                        }
                    }
                }
                // Calculate match percentage
                const matchPercentage = rowsToScan > 0 ? (httpCount / rowsToScan) : 0;
                console.log(`DEBUG: Column Scan '${header}': ${httpCount}/${rowsToScan} URLs (${(matchPercentage*100).toFixed(0)}%). Required: ${(Config.URL_SCAN_MIN_PERCENTAGE*100).toFixed(0)}%`);
                // Add to set if threshold met
                if (matchPercentage >= Config.URL_SCAN_MIN_PERCENTAGE) {
                    potentialUrlColumns.add(header);
                    console.log(`DEBUG: Added '${header}' as potential URL column via scan.`);
                }
            });
        } else {
            console.log("DEBUG: No data rows available to scan for URL content.");
        }

        // 3. Ensure default/important columns are included if they exist in headers
        if (headers.includes(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN)) potentialUrlColumns.add(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN);
        if (headers.includes(Config.DEDUPLICATION_COLUMN_NAME)) potentialUrlColumns.add(Config.DEDUPLICATION_COLUMN_NAME);

        // 4. Populate dropdown with unique, sorted column names
        const sortedUrlColumns = Array.from(potentialUrlColumns).sort((a, b) => {
             // Custom sort: Auto, download_url, url, then alphabetical
             if (a === Config.IMAGE_DOWNLOAD_SOURCE_COLUMN) return -1; if (b === Config.IMAGE_DOWNLOAD_SOURCE_COLUMN) return 1;
             if (a === Config.DEDUPLICATION_COLUMN_NAME) return -1; if (b === Config.DEDUPLICATION_COLUMN_NAME) return 1;
             return a.localeCompare(b);
        });

        sortedUrlColumns.forEach(colName => {
            const option = document.createElement('option');
            option.value = colName; option.textContent = colName;
            urlColumnSelect.appendChild(option);
            console.log(`DEBUG: Appending URL option: value="${colName}", text="${colName}"`);
        });

        // 5. Set default selection to "auto"
        urlColumnSelect.value = "_auto_";
        console.log(`DEBUG: Final URL select options: [${Array.from(urlColumnSelect.options).map(o => o.value).join(', ')}]. Selected: ${urlColumnSelect.value}`);

        // Disable select if only "Auto" option is available
        if (urlColumnSelect.options.length <= 1) {
             updateStatus("Warning: Could not detect specific URL columns. Using 'auto' mode.", "warning");
             urlColumnSelect.disabled = true;
             urlColumnSelect.dataset.initiallyDisabled = "true"; // Mark for reset logic
        } else {
            urlColumnSelect.disabled = false;
            delete urlColumnSelect.dataset.initiallyDisabled;
        }
    }

    /*
        Finds unique actions from the data and populates the action filter buttons UI.
        @param {Array<Object>} data The processed (deduplicated, urls added) data array.
    */
    function populateActionFilters(data) {
        if (!actionFilterContainer) { console.error("DEBUG: actionFilterContainer element not found!"); return; }
        actionFilterContainer.innerHTML = ''; // Clear previous buttons
        availableActions.clear(); // Clear previous unique actions state
        activeActionFilters.clear(); // Reset active filters state

        const actionColumn = Config.ACTION_COLUMN_NAME; // Use config name

        // Find unique, non-empty action values from the specified column
        data.forEach(item => {
            if (item && item.hasOwnProperty(actionColumn) && item[actionColumn] && typeof item[actionColumn] === 'string' && item[actionColumn].trim() !== '') {
                availableActions.add(item[actionColumn].trim());
            }
        });

        // Handle case where no actions are found or action column doesn't exist
        if (availableActions.size === 0) {
            console.log(`DEBUG: No unique, non-empty actions found in column '${actionColumn}'. Action filter UI will be empty.`);
            // Optionally hide the 'Filter by Action' label itself
            // const actionLabel = actionFilterContainer.closest('div').querySelector('label');
            // if (actionLabel) actionLabel.style.display = 'none';
            return; // No filters to create
        }

        // Ensure the label is visible if filters are created
        // const actionLabel = actionFilterContainer.closest('div').querySelector('label');
        // if (actionLabel) actionLabel.style.display = ''; // Or 'block'/'inline' etc.

        // Create buttons for each unique action, sorted alphabetically
        console.log(`DEBUG: Found unique actions for filtering: [${Array.from(availableActions).join(', ')}]`);
        const sortedActions = Array.from(availableActions).sort();
        sortedActions.forEach(action => {
            const button = document.createElement('button');
            button.textContent = action;
            button.classList.add('action-filter-button');
            button.dataset.action = action; // Store action name for the handler
            button.title = `Filter by action: ${action}`; // Tooltip
            button.addEventListener('click', handleActionFilterToggle);
            actionFilterContainer.appendChild(button);
        });
    }

    /*
        Toggles the active state of an action filter button and updates the filter set.
        @param {Event} event The click event from the action button.
    */
    function handleActionFilterToggle(event) {
        const button = event.target;
        const action = button.dataset.action;
        if (!action) return; // Should not happen if dataset is set correctly

        button.classList.toggle('active'); // Toggle visual state

        // Update the active filters Set
        if (button.classList.contains('active')) {
            activeActionFilters.add(action);
        } else {
            activeActionFilters.delete(action);
        }
        console.log(`DEBUG: Active action filters: [${Array.from(activeActionFilters).join(', ')}]`);

        // Provide feedback on how many items match the updated filters
        const filteredCount = applyFilters(imageData).length;
        updateStatus(`${filteredCount} items match current filters.`, 'info');
    }

    /*
        Finds and validates the presence of required columns in the headers array.
        Stores original headers. Logs warnings for missing optional columns.
        @param {Array<string>} headers The array of header strings from the CSV.
        @returns {boolean} True if all required columns are found, false otherwise.
    */
    function findRequiredColumnIndices(headers) {
        originalHeaders = [...headers]; // Store original headers exactly as found
        // Helper for case-insensitive findIndex
        const findIndex = (colName) => headers.findIndex(h => h && h.toLowerCase() === colName.toLowerCase());

        // Check required columns
        const fixedUrlIndex = findIndex(Config.DEDUPLICATION_COLUMN_NAME);
        const fixedJobIdIndex = findIndex(Config.JOB_ID_COLUMN_NAME);

        console.log(`DEBUG: Index Check - '${Config.DEDUPLICATION_COLUMN_NAME}': ${fixedUrlIndex}, '${Config.JOB_ID_COLUMN_NAME}': ${fixedJobIdIndex}`);

        let requiredMissing = false;
        if (fixedUrlIndex === -1) {
            updateStatus(`Error: Required column "${Config.DEDUPLICATION_COLUMN_NAME}" not found! Check CSV header.`, 'error');
            requiredMissing = true;
        }
        if (fixedJobIdIndex === -1) {
            updateStatus(`Error: Required column "${Config.JOB_ID_COLUMN_NAME}" not found! Check CSV header.`, 'error');
            requiredMissing = true;
        }
        if (requiredMissing) return false;

        // Check optional columns (for logging/debugging)
        const fixedDownloadUrlIndex = findIndex(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN);
        const fixedPromptIndex = findIndex(Config.OPTIONAL_PROMPT_COLUMN_NAME);
        const fixedActionIndex = findIndex(Config.ACTION_COLUMN_NAME);
        if (fixedDownloadUrlIndex === -1) console.log(`DEBUG: Optional column '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' not found.`);
        if (fixedPromptIndex === -1) console.log(`DEBUG: Optional column '${Config.OPTIONAL_PROMPT_COLUMN_NAME}' not found.`);
        if (fixedActionIndex === -1) console.log(`DEBUG: Optional column '${Config.ACTION_COLUMN_NAME}' not found.`);

        return true; // All *required* columns found
    }

    /*
        Parses the raw CSV content (excluding the header line) into an array of objects.
        Uses the provided headers as keys. Skips empty lines or lines with parsing issues.
        @param {string} csvContent The raw CSV string content.
        @param {Array<string>} headers The array of header strings.
        @returns {Array<Object>} An array of data objects parsed from the CSV.
    */
    function parseRawData(csvContent, headers) {
        const lines = csvContent.split(/\r?\n/); // Handle different line endings
        const data = [];
        if (lines.length < 2) {
             console.warn("DEBUG: No data rows found after header.");
             return data; // No data rows
        }
        const headerCount = headers.length;

        for (let i = 1; i < lines.length; i++) { // Start from 1 (skip header)
            const line = lines[i].trim();
            if (line === '') continue; // Skip empty lines

            try {
                 const values = parseCsvLine(line);
                 // Basic check: Ensure we have at least as many values as headers, or handle potentially shorter lines gracefully?
                 // Let's map based on headers, allowing shorter lines but logging warnings.
                 if (values.length > 0) {
                      const rowObject = {};
                      let hasRequiredData = true; // Flag to check if essential keys are present
                      headers.forEach((header, index) => {
                          if(header && header.trim().length > 0) { // Process only valid headers
                               const value = index < values.length ? values[index] : undefined; // Get value or undefined if index out of bounds
                               rowObject[header] = value; // Assign value (might be undefined)
                          }
                      });

                      // Check if required keys have actual values after parsing
                      if (!rowObject[Config.DEDUPLICATION_COLUMN_NAME] || !rowObject[Config.JOB_ID_COLUMN_NAME]) {
                           console.warn(`Skipping row ${i + 1} because required key ('${Config.DEDUPLICATION_COLUMN_NAME}' or '${Config.JOB_ID_COLUMN_NAME}') is missing or empty after parsing. Line: "${line}"`);
                           hasRequiredData = false;
                      }

                      // Add row only if it has some keys and required data
                      if (Object.keys(rowObject).length > 0 && hasRequiredData) {
                           data.push(rowObject);
                      } else if (!hasRequiredData) {
                           // Already warned above
                      } else {
                          console.warn(`Skipping row ${i + 1} as it resulted in an empty object after processing headers.`);
                      }
                 } else {
                      console.warn(`Skipping row ${i + 1} as CSV line parsing returned no values. Line: "${line}"`);
                 }
            } catch (parseError) {
                console.error(`Error parsing CSV line ${i + 1}. Skipping row. Error: ${parseError.message}. Line: "${line}"`);
            }
        }
        console.log(`DEBUG: Parsed ${data.length} valid data rows from CSV content.`);
        return data;
    }


    /*
        Adds or replaces the 'download_url' property in each data item if it's missing or empty.
        Uses the `extractDownloadUrlJS` function based on the deduplication column value.
        @param {Array<Object>} dataArray The array of data objects.
        @returns {Array<Object>} The array with 'download_url' potentially added or updated.
    */
    function addGeneratedDownloadUrl(dataArray) {
        console.log(`DEBUG: Ensuring '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' exists and has values.`);
        let generatedCount = 0;
        const updatedData = dataArray.map(item => {
            // Ensure item is a valid object and has the base URL column
            if (item && typeof item === 'object' && item.hasOwnProperty(Config.DEDUPLICATION_COLUMN_NAME)) {
                // Check if download URL needs generation (doesn't exist or is falsy)
                const needsGeneration = !item.hasOwnProperty(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN) || !item[Config.IMAGE_DOWNLOAD_SOURCE_COLUMN];
                if (needsGeneration) {
                    const generatedUrl = extractDownloadUrlJS(item[Config.DEDUPLICATION_COLUMN_NAME]);
                    if (generatedUrl) {
                       generatedCount++;
                       // Return new object with generated URL added/updated
                       return { ...item, [Config.IMAGE_DOWNLOAD_SOURCE_COLUMN]: generatedUrl };
                    } else {
                       console.warn(`Could not generate download URL for item with key: ${item[Config.DEDUPLICATION_COLUMN_NAME]}`);
                       // If column didn't exist, add it with null value for consistency
                       if (!item.hasOwnProperty(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN)) {
                            return { ...item, [Config.IMAGE_DOWNLOAD_SOURCE_COLUMN]: null };
                       }
                       // Otherwise return item as is (column existed but was empty, generation failed)
                       return item;
                    }
                }
            }
            // Return item unchanged if conditions aren't met or URL already exists and is valid
            return item;
        });
        if (generatedCount > 0) {
             console.log(`DEBUG: Generated download URLs for ${generatedCount} items.`);
        }
        return updatedData;
    }


    /*
        Fetches an image from a URL and triggers a browser download.
        @param {string} url The URL of the image to download.
        @param {string} filename The desired filename for the downloaded image.
        @throws {Error} If the URL is invalid, fetch fails, or network error occurs.
    */
    async function downloadImage(url, filename) {
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
            throw new Error('Invalid URL provided for download.');
        }
        console.log(`DEBUG: Attempting to download image: ${filename} from ${url}`);
        try {
            // Use fetch API to get the image data
            const response = await fetch(url);
            if (!response.ok) {
                // Throw error with status if fetch failed
                throw new Error(`Server responded with ${response.status} ${response.statusText}`);
            }
            // Get image data as a Blob
            const blob = await response.blob();

            // Create a temporary link to trigger download
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob); // Create a temporary URL for the blob
            link.download = filename; // Set the desired filename

            // Append, click, and remove the link to trigger download
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            // Release the object URL to free up memory
            URL.revokeObjectURL(link.href);
            console.log(`DEBUG: Successfully initiated download for ${filename}`);

        } catch (error) {
            // Catch fetch errors (network, CORS) or errors thrown above
            console.error(`DEBUG: Download error for ${filename} from ${url}:`, error);
            // Re-throw a potentially more specific error message
            throw new Error(`Download failed: ${error.message}`);
        }
    }

    /*
        Handles errors during image preview loading. Updates the placeholder text.
    */
    function handleImagePreviewError() {
        console.warn(`DEBUG: Failed to preload image for preview.`);
        if (imagePreviewContainer) {
            imagePreviewContainer.style.backgroundImage = 'none'; // Clear any previous image
        }
        if (imagePreviewPlaceholder) {
            imagePreviewPlaceholder.textContent = "Image preview failed."; // Show error text
            imagePreviewPlaceholder.classList.remove('hidden'); // Ensure placeholder is visible
            console.log("DEBUG: Set preview placeholder text to 'Image preview failed.'");
        }
    }

    /*
        Applies current filters (action, row limit) to the full dataset.
        @param {Array<Object>} data The full imageData array.
        @returns {Array<Object>} A new array containing only the items that match the active filters.
    */
    function applyFilters(data) {
        let filteredData = [...data]; // Start with a copy of the full data

        // 1. Apply Action Filter
        const actionColumn = Config.ACTION_COLUMN_NAME;
        // Check if filters are selected AND the action column actually exists in the data
        if (activeActionFilters.size > 0 && data.length > 0 && data[0].hasOwnProperty(actionColumn)) {
            filteredData = filteredData.filter(item =>
                // Ensure item exists, has the action column, and its value is in the active filter set
                item && item.hasOwnProperty(actionColumn) && activeActionFilters.has(item[actionColumn])
            );
            console.log(`DEBUG: Applied action filters [${Array.from(activeActionFilters).join(', ')}]. ${filteredData.length} items remain.`);
        } else if (activeActionFilters.size > 0) {
             console.log(`DEBUG: Action filters selected, but column '${actionColumn}' not found in data. Skipping action filter.`);
             // Optionally inform user? updateStatus(`Warning: Action column '${actionColumn}' not found, cannot apply action filter.`, 'warning');
        }
        else { console.log(`DEBUG: No active action filters.`); }

        // 2. Apply Row Limit Filter
        const limit = rowLimitInput ? parseInt(rowLimitInput.value, 10) : 0;
        // Apply limit only if it's a positive number and less than current filtered count
        if (!isNaN(limit) && limit > 0 && limit < filteredData.length) {
            filteredData = filteredData.slice(0, limit);
            console.log(`DEBUG: Applied row limit (${limit}). ${filteredData.length} items remain.`);
        } else { console.log(`DEBUG: No row limit applied or limit is invalid/exceeds remaining data length.`); }

        return filteredData; // Return the data that passed all filters
    }


    /*
        Starts and manages the image download loop.
        Applies filters, uses selected URL column, handles pause/stop, updates UI.
    */
    /* Starts and manages the image download loop, considering filters and URL selection. */
    async function startDownloadLoop() {
        // --- Reset flags, Apply Filters, Get dataToDownload ---
        isStopped = false; isPaused = false; currentDownloadLoopIndex = 0; successCount = 0; errorCount = 0;
        const dataToDownload = applyFilters(imageData);
        const totalItemsToDownload = dataToDownload.length;
        if (totalItemsToDownload === 0) { updateStatus("No items match filter criteria.", "warning"); resetUIDownloadFinished(); return; }

        // --- Get User's URL Column Selection ---
        const selectedOption = urlColumnSelect ? urlColumnSelect.value : "_auto_";
        let explicitUrlColumn = null; // Will hold the specific column name if user didn't choose "Auto"

        if (selectedOption !== "_auto_") {
            // User selected a specific column
            if (originalHeaders.includes(selectedOption)) {
                explicitUrlColumn = selectedOption;
                console.log(`DEBUG: User selected specific column: ${explicitUrlColumn}`);
            } else {
                // This case should be rare if dropdown is populated correctly
                updateStatus(`Error: Selected URL column '${selectedOption}' not found in headers. Cannot start download.`, "error");
                resetUIDownloadFinished(); return;
            }
        } else {
             // Auto mode is selected
             console.log(`DEBUG: Auto URL mode selected. Will prioritize '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' per item.`);
             // We will determine the column inside the loop for auto mode
        }

        // --- Update UI for Download Start ---
        updateStatus(`Starting download for ${totalItemsToDownload} item(s)...`, 'info');
        if(downloadProgress) { downloadProgress.value = 0; downloadProgress.max = totalItemsToDownload; }
        if(statusWrapper) statusWrapper.classList.remove('hidden');
        if(saveCsvButton) saveCsvButton.disabled = true;
        if(processButton) { processButton.disabled = true; processButton.textContent = 'Download running...';}
        if(pauseResumeButton) { pauseResumeButton.classList.remove('hidden'); pauseResumeButton.disabled = false; pauseResumeButton.textContent = 'Pause';}
        if(stopButton) { stopButton.classList.remove('hidden'); stopButton.disabled = false; }
        if(filterControlsDiv) { filterControlsDiv.querySelectorAll('select, input, button').forEach(el => el.disabled = true); }
        if (promptDisplayArea) { promptDisplayArea.textContent = 'Starting download...'; promptDisplayArea.scrollTop = 0; }
        if (progressContainer) progressContainer.classList.remove('hidden');

        // --- Download Loop ---
        let i = 0;
        for (i = 0; i < totalItemsToDownload; i++) {
            currentDownloadLoopIndex = i; // Track current item for async preview updates
            while (isPaused && !isStopped) { await delay(Config.DOWNLOAD_DELAY_MS); } // Handle pause
            if (isStopped) { updateStatus(`Download stopped by user at index ${i}.`, 'warning'); break; } // Handle stop

            const item = dataToDownload[i];

            // --- Determine imageUrl based on selection FOR THIS ITEM ---
            let imageUrl = null;
            let urlColumnToUse = null; // Store which column ended up being used

            if (explicitUrlColumn) {
                // User selected a specific column
                urlColumnToUse = explicitUrlColumn;
                if (item && item.hasOwnProperty(urlColumnToUse)) {
                    imageUrl = item[urlColumnToUse];
                } else {
                    // Error: item exists but selected column is missing for this item
                    updateStatus(`(${i + 1}/${totalItemsToDownload}) ERROR: Item missing selected URL column '${urlColumnToUse}'. Skipped.`, 'error');
                    errorCount++; // Increment error count here
                    // Update progress immediately for skipped item
                    if(downloadProgress) downloadProgress.value = i + 1;
                    if(progressText) progressText.textContent = `(${i + 1}/${totalItemsToDownload}) | ${successCount} OK, ${errorCount} Errors`;
                    handleImagePreviewError(); // Clear preview
                    await delay(50); // Brief pause
                    continue; // Skip to next iteration
                }
            } else {
                // Auto mode: Check 'download_url' first, then 'url' FOR THIS ITEM
                if (item && item.hasOwnProperty(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN) && item[Config.IMAGE_DOWNLOAD_SOURCE_COLUMN]) {
                    // Use download_url if it exists and has a truthy value
                    imageUrl = item[Config.IMAGE_DOWNLOAD_SOURCE_COLUMN];
                    urlColumnToUse = Config.IMAGE_DOWNLOAD_SOURCE_COLUMN;
                } else if (item && item.hasOwnProperty(Config.DEDUPLICATION_COLUMN_NAME) && item[Config.DEDUPLICATION_COLUMN_NAME]) {
                    // Fallback to url if download_url is missing or empty, but url exists and has a truthy value
                    imageUrl = item[Config.DEDUPLICATION_COLUMN_NAME];
                    urlColumnToUse = Config.DEDUPLICATION_COLUMN_NAME;
                    console.log(`DEBUG: [Loop ${i}] Auto mode using fallback column '${urlColumnToUse}'`);
                } else {
                    // Error: Neither preferred nor fallback URL column has a value for this item
                    updateStatus(`(${i + 1}/${totalItemsToDownload}) ERROR: Item missing values in both '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' and '${Config.DEDUPLICATION_COLUMN_NAME}'. Skipped.`, 'error');
                    errorCount++; // Increment error count
                    // Update progress immediately
                    if(downloadProgress) downloadProgress.value = i + 1;
                    if(progressText) progressText.textContent = `(${i + 1}/${totalItemsToDownload}) | ${successCount} OK, ${errorCount} Errors`;
                    handleImagePreviewError(); // Clear preview
                    await delay(50); // Brief pause
                    continue; // Skip to next iteration
                }
            }
            // --- End imageUrl Determination ---


            // --- Get Other Data & Validate URL ---
            const promptText = item[Config.OPTIONAL_PROMPT_COLUMN_NAME] || 'No prompt available.';
            // Check if Job ID exists *before* using it
            if (!item || !item.hasOwnProperty(Config.JOB_ID_COLUMN_NAME) || !item[Config.JOB_ID_COLUMN_NAME]) {
                 updateStatus(`(${i + 1}/${totalItemsToDownload}) ERROR: Item missing required JobID ('${Config.JOB_ID_COLUMN_NAME}'). Skipped.`, 'error');
                 errorCount++; if(downloadProgress) downloadProgress.value = i + 1; if(progressText) progressText.textContent = `(${i + 1}/${totalItemsToDownload}) | ${successCount} OK, ${errorCount} Errors`; handleImagePreviewError(); await delay(50); continue;
            }
            const jobId = item[Config.JOB_ID_COLUMN_NAME];

            if (promptDisplayArea) { promptDisplayArea.textContent = promptText; promptDisplayArea.scrollTop = 0; }

            // Validate the determined imageUrl
            if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
                updateStatus(`(${i + 1}/${totalItemsToDownload}) ERROR: Invalid/missing URL in determined column '${urlColumnToUse}'. Skipped. URL: ${imageUrl}`, 'error');
                errorCount++; if(downloadProgress) downloadProgress.value = i + 1; if(progressText) progressText.textContent = `(${i + 1}/${totalItemsToDownload}) | ${successCount} OK, ${errorCount} Errors`; handleImagePreviewError(); await delay(50); continue;
            }
            // --- End Validation ---

            // --- Image Preview ---
            console.log(`DEBUG: [Loop ${i}] Attempting preview for URL (${urlColumnToUse}): ${imageUrl}`);
            if (imagePreviewContainer && !isStopped) {
                 const tempImg = new Image();
                 tempImg.onload = () => {
                     console.log(`DEBUG: [Loop ${i}] Image loaded for preview (Index Check: ${currentDownloadLoopIndex} === ${i}, Stopped: ${isStopped})`);
                     if (currentDownloadLoopIndex === i && !isStopped) {
                         console.log(`DEBUG: [Loop ${i}] Updating preview background.`);
                         if(imagePreviewPlaceholder) imagePreviewPlaceholder.classList.add('hidden');
                         imagePreviewContainer.style.backgroundImage = `url('${tempImg.src}')`;
                     } else { console.log(`DEBUG: [Loop ${i}] Preview update skipped.`); }
                 };
                 tempImg.onerror = () => {
                      console.log(`DEBUG: [Loop ${i}] Image failed to load for preview (Index Check: ${currentDownloadLoopIndex} === ${i}, Stopped: ${isStopped})`);
                     if (currentDownloadLoopIndex === i && !isStopped) {
                         console.log(`DEBUG: [Loop ${i}] Calling handleImagePreviewError.`);
                         handleImagePreviewError();
                     } else { console.log(`DEBUG: [Loop ${i}] Preview error handling skipped.`); }
                 };
                 tempImg.src = imageUrl; // Start loading
             } else { console.log(`DEBUG: [Loop ${i}] Preview skipped (Container missing or Stopped=${isStopped}).`); }

            // --- Filename Generation ---
            let filename = `image_${i + 1}.png`; // Default
            try {
                 let filenameFromUrl = `file_${i + 1}.ext`;
                 try { const urlObj = new URL(imageUrl); const lastSegment = urlObj.pathname.substring(urlObj.pathname.lastIndexOf('/') + 1); if (lastSegment) { filenameFromUrl = decodeURIComponent(lastSegment); } }
                 catch (e) { console.warn(`DEBUG: Could not extract filename from URL: ${imageUrl}`, e); }
                 filename = `${jobId}_${filenameFromUrl}`; // Combine JobID + extracted name
            } catch (e) { console.error(`DEBUG: Error during filename generation for item ${i}`, e); filename = `error_name_${i + 1}.error`; }

            // --- Image Download Attempt ---
            try {
                await downloadImage(imageUrl, filename);
                successCount++;
                updateStatus(`(${i + 1}/${totalItemsToDownload}) OK: ${filename}`, 'success');
            } catch (error) {
                errorCount++;
                updateStatus(`(${i + 1}/${totalItemsToDownload}) ERROR downloading ${filename}: ${error.message}`, 'error');
            }

            // --- Update Progress UI ---
            if(downloadProgress) downloadProgress.value = i + 1;
            if(progressText) progressText.textContent = `(${i + 1}/${totalItemsToDownload}) Processed | ${successCount} OK, ${errorCount} Errors`;

            // --- Delay ---
            if (!isStopped && i < totalItemsToDownload - 1) {
                await delay(Config.DOWNLOAD_DELAY_MS);
            }
        } // End of for-loop

        // --- Post-Loop Cleanup ---
        console.log("DEBUG: Image download loop finished or stopped.");
        if (!isStopped) { /* ... final status update ... */ }
        else { /* ... final status update ... */ }

        resetUIDownloadFinished(); // Reset UI and re-enable filters
    }

    // ---- File Selection and Processing Logic (Downloader Page) ----

    /*
        Handles the file selection (from input or drag/drop).
        Reads the CSV, parses, deduplicates, prepares data, and populates UI filters.
        @param {File} file The selected CSV file object.
    */
    function handleFileSelect(file) {
        console.log("DEBUG: handleFileSelect called.");
        resetUIBeforeNewFile(); // Reset everything for the new file

        if (file && file.name.toLowerCase().endsWith('.csv')) {
            selectedFile = file;
            if (fileNameDisplay) fileNameDisplay.textContent = `Selected: ${file.name}`;
            updateStatus(`File "${file.name}" selected. Reading and processing...`, 'info');

            const reader = new FileReader();
            reader.onload = (e) => {
                console.log("DEBUG: FileReader onload executed.");
                fileContent = e.target.result;
                if (!fileContent || fileContent.trim() === '') { updateStatus('Error: File content is empty.', 'error'); resetUIBeforeNewFile(); return; }

                // Process Header
                const lines = fileContent.split(/\r?\n/);
                const firstLine = lines[0]?.trim(); // Trim header line as well
                if (!firstLine) { updateStatus('Error: Could not read a header line.', 'error'); resetUIBeforeNewFile(); return; }
                try {
                     csvHeaders = parseCsvLine(firstLine); // Use CSV parser for header too
                 } catch (headerParseError) {
                     updateStatus(`Error parsing header line: ${headerParseError.message}. Check CSV format/quotes.`, 'error');
                     resetUIBeforeNewFile(); return;
                 }
                if (csvHeaders.length === 0 || csvHeaders.every(h => h.trim() === '')) { updateStatus('Error: No valid headers found after parsing.', 'error'); resetUIBeforeNewFile(); return; }
                console.log("DEBUG: Headers parsed:", csvHeaders);

                // Validate required columns based on parsed headers
                if (!findRequiredColumnIndices(csvHeaders)) { resetUIBeforeNewFile(); return; }
                console.log("DEBUG: Required columns check passed.");

                // Parse Data Rows using parsed headers
                const parsedRawData = parseRawData(fileContent, csvHeaders);
                console.log(`DEBUG: Parsed ${parsedRawData.length} potentially valid data rows.`);
                // Check if parsing yielded results, even if input had more lines
                 if (parsedRawData.length === 0 && lines.length > 1) {
                     updateStatus('Warning: No valid data rows could be parsed. Check file format, delimiters, or quotes.', 'warning');
                     // Don't necessarily reset UI here, user might want to inspect headers/file
                     // Let's allow proceeding to filters, but download/save will fail later if imageData is empty
                 } else if (parsedRawData.length === 0) {
                     updateStatus('Warning: No data rows found in the file.', 'warning');
                 }


                // Deduplicate Data (only if there's data)
                let deduplicatedData = parsedRawData; // Assume no duplicates initially
                if (parsedRawData.length > 0) {
                     deduplicatedData = deduplicateData(parsedRawData, Config.DEDUPLICATION_COLUMN_NAME);
                     const duplicatesFound = parsedRawData.length - deduplicatedData.length;
                     if (duplicatesFound > 0) { updateStatus(`${duplicatesFound} duplicate row(s) removed based on '${Config.DEDUPLICATION_COLUMN_NAME}'. ${deduplicatedData.length} unique entries remain.`, 'info'); }
                     else { updateStatus(`No duplicates found based on '${Config.DEDUPLICATION_COLUMN_NAME}'. ${deduplicatedData.length} entries.`, 'info'); }
                }

                if (deduplicatedData.length === 0) {
                    updateStatus('Warning: No unique data remaining after deduplication.', 'warning');
                    // Keep UI active to allow re-uploading? Or reset? Let's keep active for now.
                    imageData = []; // Ensure imageData is empty
                } else {
                    // Ensure Download URLs exist/are generated
                    imageData = addGeneratedDownloadUrl(deduplicatedData);
                }

                // Populate Filters based on the final imageData
                populateUrlColumnSelect(originalHeaders, imageData); // Use original headers for dropdown keys, imageData for content scan
                populateActionFilters(imageData); // Populate action filters based on final data
                console.log("DEBUG: Final data prepared in imageData (first 5):", imageData.slice(0, 5));

                // Update UI to enable actions
                if(controlsDiv) controlsDiv.classList.remove('hidden');
                if(filterControlsDiv) filterControlsDiv.classList.remove('hidden');
                if(filterControlsDiv) { filterControlsDiv.querySelectorAll('select, input, button').forEach(el => { if (!el.dataset.initiallyDisabled) el.disabled = false; }); } // Enable filters
                // Enable buttons only if there is actual data to process
                if(imageData.length > 0) {
                     if(processButton) { processButton.classList.remove('hidden'); processButton.disabled = false; processButton.textContent = 'Start Download';}
                     if(saveCsvButton) { saveCsvButton.classList.remove('hidden'); saveCsvButton.disabled = false; }
                     if (promptDisplayArea) promptDisplayArea.textContent = 'Ready. Adjust filters if needed, then Start Download or Save Cleaned CSV.';
                     updateStatus(`Data processed. ${imageData.length} unique entries ready.`, 'success');
                } else {
                    // No data - keep buttons disabled/hidden
                    if(processButton) { processButton.classList.add('hidden'); processButton.disabled = true;}
                    if(saveCsvButton) { saveCsvButton.classList.add('hidden'); saveCsvButton.disabled = true; }
                    if (promptDisplayArea) promptDisplayArea.textContent = 'No processable data found in the file.';
                    updateStatus(`Processing complete, but no valid data found to download or save.`, 'warning');
                }
                if(mainContentArea) mainContentArea.classList.remove('hidden');
                if(previewAreaTitle) previewAreaTitle.classList.remove('hidden');
                console.log("DEBUG: File processing finished.");

            };
            reader.onerror = (e) => {
                updateStatus(`Error reading file: ${reader.error ? reader.error.message : 'Unknown error'}`, 'error');
                resetUIBeforeNewFile();
            };
            reader.readAsText(file, 'UTF-8'); // Read as UTF-8
        } else if (file) { // File selected but not CSV
            updateStatus('Please select a valid CSV file (.csv extension).', 'error');
            resetUIBeforeNewFile();
        } else { // Input cleared
             resetUIBeforeNewFile(); // Just reset UI
        }
    }

    // ---- Event Handlers (Downloader Page) ----

    /* Handles clicks on the 'Start Download' button. */
    function handleProcessButtonClick() {
        console.log(`DEBUG: Process button clicked.`);
        if (processButton && !processButton.disabled && imageData.length > 0) {
            console.log("DEBUG: Starting download loop via button click...");
            startDownloadLoop(); // Initiates loop (applies filters inside)
        } else {
            console.warn("Process button clicked but conditions not met (disabled or no data).");
            updateStatus('Process a valid CSV file with data first.', 'warning');
        }
    }
    /* Handles clicks on the 'Save Cleaned CSV' button. */
    function handleSaveCsvClick() {
        console.log(`DEBUG: Save CSV clicked.`);
        if (saveCsvButton && !saveCsvButton.disabled && imageData && imageData.length > 0) {
            updateStatus('Generating cleaned CSV file (applying current filters)...', 'info');
            try {
                const dataToSave = applyFilters(imageData); // Apply filters *before* saving
                if (dataToSave.length === 0) {
                    updateStatus("No items match current filters. Cannot save empty CSV.", "warning");
                    return;
                }
                updateStatus(`Applying current filters. ${dataToSave.length} entries will be saved.`, 'info');

                // Use originalHeaders for structure; generateCsvString handles adding download_url if needed
                const csvString = generateCsvString(dataToSave, originalHeaders);
                const filenameSuffix = isStopped ? '_stopped' : (activeActionFilters.size > 0 || (rowLimitInput && rowLimitInput.value)) ? '_filtered' : '';
                const filename = `data_job_${getCurrentDate()}_cleaned${filenameSuffix}.csv`;
                downloadFile(csvString, filename);
                updateStatus(`Cleaned CSV "${filename}" downloaded (${dataToSave.length} rows).`, 'success');
            } catch(e) {
                updateStatus(`Error generating CSV: ${e.message}`, 'error');
                console.error("Error generating/downloading CSV:", e);
            }
        } else {
             updateStatus('No data available/ready to save or button inactive.', 'warning');
        }
    }
    /* Handles clicks on the 'Pause' / 'Resume' button. */
    function handlePauseResumeClick() {
        if (pauseResumeButton && !pauseResumeButton.disabled) {
            isPaused = !isPaused;
            if (isPaused) {
                pauseResumeButton.textContent = 'Resume'; updateStatus('Download paused.', 'info');
                if(progressText && !isStopped) progressText.textContent += ' (Paused)';
            } else {
                pauseResumeButton.textContent = 'Pause'; updateStatus('Download resumed.', 'info');
                const currentVal = downloadProgress ? downloadProgress.value : currentDownloadLoopIndex;
                const totalVal = downloadProgress ? downloadProgress.max : 0; // Use max from progress bar
                if (progressText && !isStopped) progressText.textContent = `(${currentVal}/${totalVal}) Processed | ${successCount} OK, ${errorCount} Errors`;
            }
        }
    }
    /* Handles clicks on the 'Stop' button. */
    function handleStopClick() {
        if (stopButton && !stopButton.disabled) {
            isStopped = true; isPaused = false; // Ensure loop doesn't stay paused
            updateStatus('Stop requested... Finishing current operation if any.', 'warning');
            if(stopButton) stopButton.disabled = true; // Disable stop button
            if(pauseResumeButton) { pauseResumeButton.disabled = true; pauseResumeButton.textContent = 'Pause'; } // Disable pause
            // Loop will detect isStopped flag and handle UI reset via resetUIDownloadFinished
        }
    }

    // ---- Event Listeners Setup ----
    if (manualUploadTrigger && csvFileInput) {
        manualUploadTrigger.addEventListener('click', (event) => {
            console.log("DEBUG: manualUploadTrigger clicked!");
            event.stopPropagation();
            event.preventDefault();
            csvFileInput.value = null; // Reset input value! Important!
            console.log("DEBUG: Attempting to click csvFileInput:", csvFileInput);
            try {
                csvFileInput.click(); // Programmatically click the hidden input
                console.log("DEBUG: csvFileInput.click() called successfully.");
            } catch (e) {
                 console.error("DEBUG: Error calling csvFileInput.click():", e);
                 updateStatus("Error opening file dialog. Check browser settings or try drag & drop.", "error");
            }
        });
    }
    if (dropZoneTarget) {
        dropZoneTarget.addEventListener('dragover', (e) => { e.stopPropagation(); e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; dropZoneTarget.classList.add('hover'); });
        dropZoneTarget.addEventListener('dragleave', () => { dropZoneTarget.classList.remove('hover'); });
        dropZoneTarget.addEventListener('drop', (e) => {
             e.stopPropagation(); e.preventDefault(); dropZoneTarget.classList.remove('hover');
             if (e.dataTransfer.files.length > 0) { handleFileSelect(e.dataTransfer.files[0]); }
        });
    }
    if (csvFileInput) {
        csvFileInput.addEventListener('change', (e) => {
             if (e.target.files.length > 0) { handleFileSelect(e.target.files[0]); }
             else { handleFileSelect(null); } // Handle clearing selection
        });
    }
    if (processButton) processButton.addEventListener('click', handleProcessButtonClick);
    if (saveCsvButton) saveCsvButton.addEventListener('click', handleSaveCsvClick);
    if (pauseResumeButton) pauseResumeButton.addEventListener('click', handlePauseResumeClick);
    if (stopButton) stopButton.addEventListener('click', handleStopClick);

    // Initial UI reset on page load
    resetUIBeforeNewFile();

  } else {
    // Fallback for other pages (e.g., index.html)
    console.log("Initializing logic for a page other than file_download.html or get_images.html.");
    // No specific actions needed here based on the original code.
  }

}); // End DOMContentLoaded