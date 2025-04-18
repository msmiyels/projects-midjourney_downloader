// --- script.js ---

/*
     @fileoverview Main script handling UI interactions and data processing
     for different HTML pages (get_images.html, file_download.html).
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
  JOB_ID_COLUMN_NAME: 'job_id'
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
     Gets the current date formatted as YYYY-MM-DD.
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
     @returns {string} The escaped CSV value.
*/
function escapeCsvValue(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  let stringValue = String(value);
  /*
      If the value contains a double quote, comma, newline, or carriage return,
      escape double quotes by doubling them and enclose the whole value in double quotes.
 */
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
    @param {Array<string>} headers An array of header strings.
    @returns {string} The generated CSV string (including BOM).
*/
function generateCsvString(dataArray, headers) {
  if (!dataArray || dataArray.length === 0) return '';

  const finalHeaders = [...headers];
  // Ensure the download source column header is present if data for it exists
  if (dataArray[0] && !finalHeaders.includes(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN) && dataArray[0].hasOwnProperty(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN)) {
    finalHeaders.push(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN);
  }

  const headerRow = finalHeaders.map(escapeCsvValue).join(',');
  const dataRows = dataArray.map(row => {
    return finalHeaders.map(header => {
      const value = row.hasOwnProperty(header) ? row[header] : '';
      return escapeCsvValue(value);
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
    Handles double quotes within quoted fields.
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
      let finalVal = currentVal;
      // Basic handling to remove surrounding quotes if they exist ONLY at start/end
      if (finalVal.startsWith('"') && finalVal.endsWith('"')) {
         finalVal = finalVal.substring(1, finalVal.length - 1);
      }
      // Replace escaped double quotes ("") with single double quotes (")
      finalVal = finalVal.replace(/""/g, '"');
      values.push(finalVal.trim());
      currentVal = ''; // Reset for next value
    } else {
      // Append character to current value
      currentVal += char;
    }
  }

  // Add the last value
  let finalVal = currentVal;
   if (finalVal.startsWith('"') && finalVal.endsWith('"')) {
      finalVal = finalVal.substring(1, finalVal.length - 1);
   }
  finalVal = finalVal.replace(/""/g, '"');
  values.push(finalVal.trim());

  return values;
}

/*
    Deduplicates an array of objects based on a specified key.
    Keeps the first occurrence of each unique key.
    @param {Array<Object>} dataArray The array of objects to deduplicate.
    @param {string} key The property name to use as the deduplication key.
    @returns {Array<Object>} A new array containing only unique items.
*/
function deduplicateData(dataArray, key) {
  const uniqueMap = new Map();
  dataArray.forEach(item => {
    if (item && typeof item === 'object' && item.hasOwnProperty(key) && !uniqueMap.has(item[key])) {
      uniqueMap.set(item[key], item);
    } else if (!item || typeof item !== 'object' || !item.hasOwnProperty(key)) {
      // Log items that cannot be deduplicated properly
      console.warn("Skipping invalid item during deduplication:", item);
    }
  });
  const uniqueData = Array.from(uniqueMap.values());
  console.log(`DEBUG: Deduplication complete. Started with ${dataArray.length}, ended with ${uniqueData.length} unique items based on key '${key}'.`);
  return uniqueData;
}

/*
    Extracts or generates a simplified download URL from a given source URL.
    Assumes a pattern like '.../abc.ext' -> '.../abc.ext' or '.../abc_extra/xyz.ext' -> '.../abc.ext'
    Attempts to construct a URL ending in the first 3 chars of the filename + extension.
    @param {string|null} url The source URL string.
    @returns {string|null} The extracted/generated download URL, or null if parsing fails.
*/
function extractDownloadUrlJS(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    // Basic extraction logic (adjust if needed)
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

    // Attempt to prepend origin if basePath is relative
    try {
        const originalUrlObj = new URL(url); // Use original URL for origin
        if (!basePath.startsWith('http') && originalUrlObj.origin !== 'null') {
            finalUrl = `${originalUrlObj.origin}${basePath}/${newFilename}`;
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

  // Get references to common DOM elements (might be null depending on the page)
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

    // --- Modal Helper Functions ---

    /* Resets the copy button text and enabled state.*/
    function resetCopyButtonState() {
      if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Copy';
      if (copyCodeBtn) copyCodeBtn.disabled = !modalCodeContent || !modalCodeContent.textContent;
    }

    /*
        Fetches code from a script path and displays it in the modal.
        @param {HTMLElement} buttonElement The button that triggered the modal, containing dataset attributes.
    */
    async function showCodeModal(buttonElement) {
      const scriptPath = buttonElement.dataset.scriptPath;
      const title = buttonElement.dataset.title || 'Code Snippet';

      modalTitle.textContent = title;
      modalCodeContent.textContent = 'Loading code...';
      modalError.style.display = 'none';
      modalError.textContent = '';
      resetCopyButtonState();
      if (copyCodeBtn) copyCodeBtn.disabled = true; // Disable copy button while loading
      codeModal.style.display = 'block';

      try {
        console.log(`Workspaceing code from: ${scriptPath}`);
        const response = await fetch(scriptPath);
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
        }
        const codeText = await response.text();
        modalCodeContent.textContent = codeText;
        if (copyCodeBtn) copyCodeBtn.disabled = false; // Enable copy button
        console.log(`Successfully loaded code from ${scriptPath}`);
      } catch (error) {
        console.error('Error loading script content:', error);
        modalCodeContent.textContent = ''; // Clear loading text
        modalError.textContent = `Error loading code from "${scriptPath}": ${error.message}. Check path and server.`;
        modalError.style.display = 'block';
        if (copyCodeBtn) copyCodeBtn.disabled = true;
      }
    }

    /* Hides the code modal and resets its content.*/
    function hideCodeModal() {
      if (codeModal) {
        codeModal.style.display = 'none';
        modalCodeContent.textContent = '';
        modalError.style.display = 'none';
        resetCopyButtonState();
      }
    }

    /* Copies the code content from the modal to the clipboard.*/
    async function copyCodeToClipboard() {
      const codeToCopy = modalCodeContent.textContent;
      if (!navigator.clipboard || !codeToCopy) {
        if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Error';
        setTimeout(resetCopyButtonState, 2000);
        return;
      }

      if (copyCodeBtn) copyCodeBtn.disabled = true; // Prevent double-clicks

      try {
        await navigator.clipboard.writeText(codeToCopy);
        if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Copied!';
        console.log('Code copied to clipboard.');
        setTimeout(() => {
          resetCopyButtonState(); // Also re-enables the button
        }, 2000);
      } catch (err) {
        console.error('Failed to copy code to clipboard:', err);
        if (copyButtonTextSpan) copyButtonTextSpan.textContent = 'Error';
        modalError.textContent = 'Copying to clipboard failed.';
        modalError.style.display = 'block';
        setTimeout(() => {
          resetCopyButtonState(); // Also re-enables the button
          modalError.style.display = 'none';
        }, 3000);
      }
    }

    // --- Modal Event Listeners ---
    showManualCodeBtn.addEventListener('click', () => showCodeModal(showManualCodeBtn));
    showAutoCodeBtn.addEventListener('click', () => showCodeModal(showAutoCodeBtn));
    if (closeModalBtn) closeModalBtn.addEventListener('click', hideCodeModal);
    if (copyCodeBtn) copyCodeBtn.addEventListener('click', copyCodeToClipboard);
    // Close modal if clicking outside the content area
    codeModal.addEventListener('click', (event) => {
      if (event.target === codeModal) {
        hideCodeModal();
      }
    });
    // Close modal on Escape key press
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && codeModal.style.display === 'block') {
        hideCodeModal();
      }
    });

  }
  // --- Logic for file_download.html (Downloader) ---
  else if (processButton && saveCsvButton) {
    console.log("Initializing logic for file_download.html (Downloader)");

    // Get specific DOM elements for this page
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

    // State variables for the downloader
    let selectedFile = null;
    let fileContent = null;
    let csvHeaders = [];
    let imageData = []; // Processed and deduplicated data for download
    let originalHeaders = []; // Headers as found in the original file
    let fixedUrlIndex = -1; // Index of the deduplication key column
    let fixedDownloadUrlIndex = -1; // Index of the download source column
    let fixedPromptIndex = -1; // Index of the optional prompt column
    let fixedJobIdIndex = -1; // Index of the job ID column
    let isPaused = false;
    let isStopped = false;
    let currentDownloadLoopIndex = 0; // Track which item the loop is currently processing
    let successCount = 0; // Count successful downloads
    let errorCount = 0; // Count download errors

    /*
        Updates the status log area with a timestamped message.
        @param {string} message The message to display.
        @param {'info'|'success'|'warning'|'error'} [type='info'] The type of message (affects styling).
    */
    function updateStatus(message, type = 'info') {
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const logEntry = document.createElement('div');
      logEntry.textContent = `[${timestamp}] ${message}`;
      logEntry.classList.add('log-entry', type); // Add type class for styling

      if (statusDiv) {
        // Make status area visible if hidden and clear previous content only if starting fresh
        if (statusWrapper && statusWrapper.classList.contains('hidden')) {
             statusWrapper.classList.remove('hidden');
             statusDiv.innerHTML = ''; // Clear only when first shown
        }
        // Prepend new entry
        statusDiv.insertBefore(logEntry, statusDiv.firstChild);
      } else {
        // Fallback if statusDiv is missing
        console.error("Downloader Page: Status Div not found!");
      }
      // Also log to console
      console.log(`[DOWNLOADER - ${type.toUpperCase()}] ${message}`);
    }

    /*
        Resets the UI to its initial state before a new file is processed.
        Clears state variables, hides/disables controls, resets progress and previews.
    */
    function resetUIBeforeNewFile() {
      selectedFile = null;
      fileContent = null;
      csvHeaders = [];
      imageData = [];
      originalHeaders = [];
      fixedUrlIndex = -1;
      fixedDownloadUrlIndex = -1;
      fixedPromptIndex = -1;
      fixedJobIdIndex = -1;
      isPaused = false;
      isStopped = false;
      currentDownloadLoopIndex = 0;
      successCount = 0;
      errorCount = 0;

      if (fileNameDisplay) fileNameDisplay.textContent = '';
      if (controlsDiv) controlsDiv.classList.add('hidden');
      if (processButton) {
        processButton.classList.add('hidden');
        processButton.disabled = true;
        processButton.textContent = 'Start Download'; // Reset text
      }
      if (saveCsvButton) {
        saveCsvButton.classList.add('hidden');
        saveCsvButton.disabled = true;
      }
      if (mainContentArea) mainContentArea.classList.add('hidden');
      if (previewAreaTitle) previewAreaTitle.classList.add('hidden');
      if (promptDisplayArea) promptDisplayArea.textContent = 'Upload an original CSV file.';
      if (progressContainer) progressContainer.classList.add('hidden');
      if (pauseResumeButton) {
        pauseResumeButton.classList.add('hidden');
        pauseResumeButton.textContent = 'Pause';
        pauseResumeButton.disabled = false; // Re-enable for next run
      }
      if (stopButton) {
        stopButton.classList.add('hidden');
        stopButton.disabled = false; // Re-enable for next run
      }
      // Reset image preview
      if (imagePreviewContainer) imagePreviewContainer.style.backgroundImage = 'none';
      if (imagePreviewPlaceholder) {
        imagePreviewPlaceholder.textContent = "No image preview available.";
        imagePreviewPlaceholder.classList.remove('hidden');
      }
      // Reset progress bar and text
      if (downloadProgress) downloadProgress.value = 0;
      if (progressText) progressText.textContent = '';
      // Hide status area initially
      if (statusWrapper) statusWrapper.classList.add('hidden');
      if (statusDiv) statusDiv.innerHTML = ''; // Clear status messages
      // Reset file input visually
      if (csvFileInput) csvFileInput.value = null;
      console.log("DEBUG: UI reset for downloader.html executed.");
    }

    /*
        Resets UI elements after a download process finishes or is stopped.
        Hides progress/pause/stop buttons. Keeps 'Save Cleaned CSV' active if stopped.
    */
    function resetUIDownloadFinished() {
        if(processButton){
            processButton.classList.add('hidden');
            processButton.disabled = true;
            processButton.textContent = 'Start Download'; // Reset text
        }
        // Keep 'Save CSV' button visible and enabled only if the process was stopped mid-way
        if(saveCsvButton){
            if (isStopped) {
                saveCsvButton.classList.remove('hidden');
                saveCsvButton.disabled = false;
            } else {
                // Hide/disable if finished normally (adjust if needed)
                saveCsvButton.classList.add('hidden');
                saveCsvButton.disabled = true;
            }
        }
        if(pauseResumeButton) {
            pauseResumeButton.classList.add('hidden');
            pauseResumeButton.disabled = false; // Re-enable for next run
            pauseResumeButton.textContent = 'Pause'; // Reset text
        }
        if(stopButton) {
            stopButton.classList.add('hidden');
            stopButton.disabled = false; // Re-enable for next run
        }

        // Reset preview area with appropriate message
        if (imagePreviewContainer) { imagePreviewContainer.style.backgroundImage = 'none'; }
        if (imagePreviewPlaceholder) {
            imagePreviewPlaceholder.textContent = isStopped ? "Download stopped." : "Action completed.";
            imagePreviewPlaceholder.classList.remove('hidden');
        }
        // Update prompt display area
        if (promptDisplayArea) {
            promptDisplayArea.textContent = isStopped ? 'Download stopped.' : 'Action completed.';
        }

        // isPaused is implicitly reset as the loop ends
        // isStopped remains true until a new file is processed or download starts

        console.log("DEBUG: UI reset after action finished/stopped executed. isStopped:", isStopped);
    }


    /*
        Finds and stores the indices of required and optional columns in the headers array.
        Updates status with errors if required columns are missing.
        @param {Array<string>} headers The array of header strings from the CSV.
        @returns {boolean} True if all required columns are found, false otherwise.
    */
    function findRequiredColumnIndices(headers) {
        originalHeaders = [...headers]; // Store original headers for later use
        fixedUrlIndex = headers.findIndex(h => h.toLowerCase() === Config.DEDUPLICATION_COLUMN_NAME.toLowerCase());
        fixedDownloadUrlIndex = headers.findIndex(h => h.toLowerCase() === Config.IMAGE_DOWNLOAD_SOURCE_COLUMN.toLowerCase());
        fixedPromptIndex = headers.findIndex(h => h.toLowerCase() === Config.OPTIONAL_PROMPT_COLUMN_NAME.toLowerCase());
        fixedJobIdIndex = headers.findIndex(h => h.toLowerCase() === Config.JOB_ID_COLUMN_NAME.toLowerCase());

        console.log(`DEBUG: Found indices - Dedupe Key ('${Config.DEDUPLICATION_COLUMN_NAME}'): ${fixedUrlIndex}, Download Source ('${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}'): ${fixedDownloadUrlIndex}, Prompt ('${Config.OPTIONAL_PROMPT_COLUMN_NAME}'): ${fixedPromptIndex}, JobID ('${Config.JOB_ID_COLUMN_NAME}'): ${fixedJobIdIndex}`);

        // Check for required columns
        if (fixedUrlIndex === -1) {
            updateStatus(`Error: Required column "${Config.DEDUPLICATION_COLUMN_NAME}" for deduplication not found!`, 'error');
            return false;
        }
         if (fixedJobIdIndex === -1) {
            updateStatus(`Error: Required column "${Config.JOB_ID_COLUMN_NAME}" not found!`, 'error');
            return false;
        }

        // Log info about optional columns
        if (fixedDownloadUrlIndex === -1) { console.log(`DEBUG: Column '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' not found, will attempt to generate it.`); }
        else { console.log(`DEBUG: Column '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' found, will use its values (and generate if empty).`); }
        if (fixedPromptIndex === -1) { console.log(`DEBUG: Optional column '${Config.OPTIONAL_PROMPT_COLUMN_NAME}' not found.`); }

        return true; // All required columns found
    }

    /*
        Parses the raw CSV content (excluding the header line) into an array of objects.
        Uses the provided headers as keys for the objects. Skips empty lines or lines with mismatched column counts.
        @param {string} csvContent The raw CSV string content.
        @param {Array<string>} headers The array of header strings.
        @returns {Array<Object>} An array of data objects parsed from the CSV.
    */
    function parseRawData(csvContent, headers) {
        const lines = csvContent.split(/\r?\n/); // Handles both Windows and Unix line endings
        const data = [];
        if (lines.length < 2) return data; // No data rows

        const headerCount = headers.length;

        for (let i = 1; i < lines.length; i++) { // Start from 1 to skip header row
            const line = lines[i].trim();
            if (line === '') continue; // Skip empty lines

            const values = parseCsvLine(line);

            if (values.length >= headerCount) { // Allow more columns than headers, ignore extra
                const rowObject = {};
                headers.forEach((header, index) => {
                    // Only add if header is valid (not empty)
                    if(header && header.trim().length > 0) {
                        rowObject[header] = values[index];
                    } else {
                        console.warn(`Skipping column with empty header at index ${index} in row ${i + 1}.`);
                    }
                });
                // Only add row if it has at least one property
                if (Object.keys(rowObject).length > 0) {
                    data.push(rowObject);
                }
            } else {
                console.warn(`Skipping row ${i + 1} due to insufficient column count (${values.length} found, ${headerCount} expected). Line: "${line}"`);
            }
        }
        return data;
    }

    /*
        Adds or replaces the 'download_url' property in each data item if it's missing or empty.
        Uses the `extractDownloadUrlJS` function based on the deduplication column value.
        @param {Array<Object>} dataArray The array of data objects.
        @returns {Array<Object>} The array with 'download_url' potentially added or updated.
    */
    function addGeneratedDownloadUrl(dataArray) {
        console.log(`DEBUG: Ensuring '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' column exists and has values.`);
        return dataArray.map(item => {
            if (item && typeof item === 'object' && item.hasOwnProperty(Config.DEDUPLICATION_COLUMN_NAME)) {
                // Generate if the column doesn't exist OR if it exists but is empty/falsy
                if (!item.hasOwnProperty(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN) || !item[Config.IMAGE_DOWNLOAD_SOURCE_COLUMN] ) {
                    const generatedUrl = extractDownloadUrlJS(item[Config.DEDUPLICATION_COLUMN_NAME]);
                    // Only add the property if generation was successful
                    if (generatedUrl) {
                       return { ...item, [Config.IMAGE_DOWNLOAD_SOURCE_COLUMN]: generatedUrl };
                    } else {
                       console.warn(`Could not generate download URL for item with key: ${item[Config.DEDUPLICATION_COLUMN_NAME]}`);
                       // Return item as is, possibly without the download URL
                       return item;
                    }
                }
            }
            // Return item unchanged if conditions aren't met or URL already exists
            return item;
        });
    }

    /*
        Fetches an image from a URL and triggers a browser download.
        @param {string} url The URL of the image to download.
        @param {string} filename The desired filename for the downloaded image.
        @throws {Error} If the URL is invalid, fetch fails, or network error occurs.
    */
    async function downloadImage(url, filename) {
        if (!url || typeof url !== 'string' || !url.startsWith('http')) {
            throw new Error('Invalid URL for download.');
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                // Provide more context in the error
                throw new Error(`Server responded with ${response.status} ${response.statusText}`);
            }
            const blob = await response.blob();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = filename;
            document.body.appendChild(link); // Required for Firefox
            link.click();
            document.body.removeChild(link); // Clean up
            URL.revokeObjectURL(link.href); // Release memory
        } catch (error) {
            // Catch fetch errors (network, CORS) or errors thrown above
            console.error(`DEBUG: Download error for ${filename} from ${url}:`, error);
            // Re-throw a more user-friendly error message if possible
            throw new Error(`Network/Fetch error: ${error.message}`);
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
        }
    }

    /*
        Starts and manages the image download loop.
        Iterates through `imageData`, handles pause/stop signals, updates progress,
        triggers downloads, and updates the UI.
    */
    async function startDownloadLoop() {
        currentDownloadLoopIndex = 0;
        successCount = 0;
        errorCount = 0; // Reset counters for this run

        if(downloadProgress) downloadProgress.value = 0;
        if(downloadProgress) downloadProgress.max = imageData.length;
        if(statusWrapper) statusWrapper.classList.remove('hidden'); // Show status area
        if(saveCsvButton) saveCsvButton.disabled = true; // Disable saving CSV during download
        if(processButton) { processButton.disabled = true; processButton.textContent = 'Download running...';}
        if(pauseResumeButton) pauseResumeButton.classList.remove('hidden'); // Show controls
        if(stopButton) stopButton.classList.remove('hidden');

        if (promptDisplayArea) { promptDisplayArea.textContent = 'Starting download...'; promptDisplayArea.scrollTop = 0; } // Scroll to top
        console.log(`DEBUG: Starting image download loop for ${imageData.length} items using '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}'.`);

        let i = 0; // Loop counter declared outside for access after loop stops
        for (i = 0; i < imageData.length; i++) {
            currentDownloadLoopIndex = i; // Track the current item index

            // Pause loop execution if isPaused is true (and not stopped)
            while (isPaused && !isStopped) {
                await delay(Config.DOWNLOAD_DELAY_MS); // Wait briefly before checking again
            }

            // Check if stop was requested *inside* the loop
            if (isStopped) {
                updateStatus(`Download stopped by user at index ${i}.`, 'warning');
                break; // Exit the loop immediately
            }

            const item = imageData[i];
            const imageUrl = item[Config.IMAGE_DOWNLOAD_SOURCE_COLUMN]; // Get URL from the designated column
            const promptText = item[Config.OPTIONAL_PROMPT_COLUMN_NAME] || 'No prompt available.';
            const jobId = item[Config.JOB_ID_COLUMN_NAME] || `jobid_${i + 1}`; // Use Job ID or fallback

            // Update prompt display
            if (promptDisplayArea) {
                 promptDisplayArea.textContent = promptText;
                 promptDisplayArea.scrollTop = 0; // Scroll to top for long prompts
            }

            // Validate the image URL
            if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
                updateStatus(`(${i + 1}/${imageData.length}) ERROR: Invalid or missing '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' for item ${i+1}. Skipped. URL: ${imageUrl}`, 'error');
                errorCount++;
                if(downloadProgress) downloadProgress.value = i + 1;
                if(progressText) progressText.textContent = `(${i + 1}/${imageData.length}) Processed | ${successCount} OK, ${errorCount} Errors`;
                handleImagePreviewError(); // Show error state in preview area
                await delay(50); // Short delay even on error
                continue; // Skip to the next item
            }

            // --- Image Preview Loading ---
            if (imagePreviewContainer && !isStopped) { // Don't attempt preload if stopped
                console.log(`DEBUG: Attempting to preload image preview for ${imageUrl}`);
                const tempImg = new Image();
                tempImg.onload = () => {
                    console.log(`DEBUG: Image preview loaded successfully for ${imageUrl}`);
                    // Update preview ONLY if the loop is still processing this item and not stopped
                    if (currentDownloadLoopIndex === i && !isStopped) {
                        if(imagePreviewPlaceholder) imagePreviewPlaceholder.classList.add('hidden'); // Hide placeholder
                        imagePreviewContainer.style.backgroundImage = `url('${tempImg.src}')`;
                    }
                };
                tempImg.onerror = () => {
                    // Handle error ONLY if the loop is still processing this item and not stopped
                    if (currentDownloadLoopIndex === i && !isStopped) {
                        handleImagePreviewError();
                    }
                };
                tempImg.src = imageUrl; // Start loading the image
            } else if (!imagePreviewContainer) {
                 console.error("DEBUG: imagePreviewContainer element not found!");
            }
            // --- End Image Preview Loading ---


            // --- Filename Generation ---
            let filename = `image_${i + 1}.png`; // Default fallback filename
            try {
                let filenameFromDownloadUrl = `file_${i + 1}.ext`; // Fallback filename + ext

                // Attempt to extract filename from the download_url
                if (imageUrl) {
                    try {
                        const urlObj = new URL(imageUrl);
                        const pathname = urlObj.pathname;
                        const lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
                        if (lastSegment) { // Use only if not empty
                            filenameFromDownloadUrl = decodeURIComponent(lastSegment);
                        } else {
                             console.warn(`DEBUG: Could not extract filename from path: ${imageUrl}. Using fallback: ${filenameFromDownloadUrl}`);
                        }
                    } catch (e) {
                        console.warn(`DEBUG: Could not parse download_url to extract filename: ${imageUrl}`, e);
                    }
                } else {
                     console.warn(`DEBUG: download_url is empty. Using fallback filename: ${filenameFromDownloadUrl}`);
                }

                // Combine Job ID and extracted filename
                filename = `${jobId}_${filenameFromDownloadUrl}`;
                console.log(`DEBUG: Generated filename: ${filename}`);

            } catch (e) {
                console.error(`DEBUG: General error during filename generation for item ${i}`, e);
                filename = `error_generating_name_${i + 1}.error`; // Use error indicator in filename
            }
             // --- End Filename Generation ---

            // --- Image Download ---
            try {
                await downloadImage(imageUrl, filename);
                successCount++;
                updateStatus(`(${i + 1}/${imageData.length}) OK: ${imageUrl}`, 'success');
            } catch (error) {
                errorCount++;
                // Error message now comes from downloadImage function
                updateStatus(`(${i + 1}/${imageData.length}) ERROR downloading ${imageUrl}: ${error.message}`, 'error');
            }
            // --- End Image Download ---

            // Update progress bar and text after attempt
            if(downloadProgress) downloadProgress.value = i + 1;
            if(progressText) progressText.textContent = `(${i + 1}/${imageData.length}) Processed | ${successCount} OK, ${errorCount} Errors`;

            // Delay before next iteration, but only if not stopped and not the last item
            if (!isStopped && i < imageData.length - 1) {
                await delay(Config.DOWNLOAD_DELAY_MS);
            }
        } // End of for-loop

        console.log("DEBUG: Image download loop finished or stopped.");

        // Final status update after the loop
        if (!isStopped) {
            updateStatus(`Image download completed. ${successCount} OK, ${errorCount} failed.`, 'success');
            if (progressText) progressText.textContent = `Finished! ${successCount} OK, ${errorCount} Errors`;
        } else {
            // Status for 'stopped' is handled by resetUIDownloadFinished now
            if (progressText) progressText.textContent = `Stopped after ${i} attempts. ${successCount} OK, ${errorCount} Errors`;
        }

        // Reset UI elements (handles the stopped state internally)
        resetUIDownloadFinished();
    }


    // ---- File Selection and Processing Logic (Downloader Page) ----

    /*
        Handles the file selection (from input or drag/drop).
        Reads the CSV file, parses headers and data, performs deduplication,
        generates download URLs if needed, and updates the UI to enable actions.
        @param {File} file The selected CSV file object.
    */
    function handleFileSelect(file) {
        console.log("DEBUG: handleFileSelect (downloader page) called.");
        resetUIBeforeNewFile(); // Reset everything for the new file

        if (file && file.name.toLowerCase().endsWith('.csv')) {
            selectedFile = file;
            if (fileNameDisplay) fileNameDisplay.textContent = `Selected: ${file.name}`;
            updateStatus(`File "${file.name}" selected. Reading and processing...`, 'info');

            const reader = new FileReader();
            reader.onload = (e) => {
                console.log("DEBUG: FileReader onload triggered.");
                fileContent = e.target.result;
                if (!fileContent || fileContent.trim() === '') {
                    updateStatus('Error: File content is empty.', 'error');
                    resetUIBeforeNewFile(); return;
                }

                // Parse Header Line
                const lines = fileContent.split(/\r?\n/);
                const firstLine = lines[0];
                if (!firstLine) {
                    updateStatus('Error: Could not find a header line.', 'error');
                    resetUIBeforeNewFile(); return;
                }
                csvHeaders = parseCsvLine(firstLine); // Use CSV parser for header to handle quotes
                if (csvHeaders.length === 0 || csvHeaders.every(h => h.trim() === '')) {
                    updateStatus('Error: No valid headers found. Check delimiter and file format.', 'error');
                    resetUIBeforeNewFile(); return;
                }
                console.log("DEBUG: Headers parsed:", csvHeaders);

                // Find required column indices
                if (!findRequiredColumnIndices(csvHeaders)) {
                    resetUIBeforeNewFile(); // Error message already shown by findRequiredColumnIndices
                    return;
                }
                console.log("DEBUG: Required/optional columns check passed.");

                // Parse Data Rows
                const parsedRawData = parseRawData(fileContent, csvHeaders);
                console.log(`DEBUG: Parsed ${parsedRawData.length} raw data rows.`);
                if (parsedRawData.length === 0 && lines.length > 1) {
                     // Check if there were potential data lines that failed parsing
                     updateStatus('Warning: No valid data rows found to process. Check format, delimiter, or quotes.', 'warning');
                     resetUIBeforeNewFile(); return;
                 } else if (parsedRawData.length === 0) {
                     // File had header but no data lines
                     updateStatus('Warning: No data rows found in the file.', 'warning');
                     resetUIBeforeNewFile(); return;
                 }

                // Deduplicate Data
                const deduplicatedData = deduplicateData(parsedRawData, Config.DEDUPLICATION_COLUMN_NAME);
                const duplicatesFound = parsedRawData.length - deduplicatedData.length;
                if (duplicatesFound > 0) {
                    updateStatus(`${duplicatesFound} duplicate(s) removed based on '${Config.DEDUPLICATION_COLUMN_NAME}'. ${deduplicatedData.length} unique entries remain.`, 'info');
                } else {
                    updateStatus(`No duplicates found based on '${Config.DEDUPLICATION_COLUMN_NAME}'. ${deduplicatedData.length} entries.`, 'info');
                }
                if (deduplicatedData.length === 0) {
                    updateStatus('Warning: No unique data remaining after deduplication.', 'warning');
                    resetUIBeforeNewFile(); return;
                }

                // Generate Download URLs if necessary (also handles empty existing column)
                imageData = addGeneratedDownloadUrl(deduplicatedData);
                if (fixedDownloadUrlIndex === -1) {
                    updateStatus(`Column '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' was generated.`, 'info');
                    // Add the header if it wasn't present originally for CSV saving
                    if (!originalHeaders.includes(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN)) {
                         originalHeaders.push(Config.IMAGE_DOWNLOAD_SOURCE_COLUMN);
                         console.log(`DEBUG: Added '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' to originalHeaders for CSV export.`);
                    }
                } else {
                     updateStatus(`Using column '${Config.IMAGE_DOWNLOAD_SOURCE_COLUMN}' (missing/empty values generated if possible).`, 'info');
                }
                console.log("DEBUG: Final data prepared in imageData (first 5):", imageData.slice(0, 5));

                // Update UI - Ready for Download or Save
                if(controlsDiv) controlsDiv.classList.remove('hidden');
                if(processButton) { processButton.classList.remove('hidden'); processButton.disabled = false; processButton.textContent = 'Start Download';}
                if(saveCsvButton) { saveCsvButton.classList.remove('hidden'); saveCsvButton.disabled = false; } // Enable save button
                if(mainContentArea) mainContentArea.classList.remove('hidden');
                if(previewAreaTitle) previewAreaTitle.classList.remove('hidden');
                if (promptDisplayArea) promptDisplayArea.textContent = 'Ready to start download or save cleaned CSV.';
                updateStatus(`Data successfully processed. ${imageData.length} entries ready.`, 'success');
                console.log("DEBUG: Processing successful. Ready for next step.");

            };
            reader.onerror = (e) => {
                updateStatus(`Error reading file: ${reader.error}`, 'error');
                resetUIBeforeNewFile();
            };
            reader.readAsText(file, 'UTF-8'); // Explicitly use UTF-8
        } else if (file) { // If a file was selected but wasn't CSV
            updateStatus('Please select a valid CSV file (.csv extension).', 'error');
            resetUIBeforeNewFile();
        } else { // No file selected (e.g., input cleared)
             resetUIBeforeNewFile(); // Just reset the UI
        }
    }

    // ---- Event Handlers (Downloader Page) ----

    /* Handles clicks on the 'Start Download' button.*/
    function handleProcessButtonClick() {
        console.log(`DEBUG: Process button clicked, disabled: ${processButton?.disabled}, data length: ${imageData.length}`);
        // Proceed only if button is enabled and there's data to process
        if (processButton && !processButton.disabled && imageData.length > 0) {
            // --- IMPORTANT: Reset stop/pause flags before starting a new run ---
            isStopped = false;
            isPaused = false;

            processButton.disabled = true; // Disable start button during run
            if(saveCsvButton) saveCsvButton.disabled = true; // Disable save button during run
            processButton.textContent = 'Download running...';
            // Ensure pause/stop buttons are visible and correctly configured
            if(pauseResumeButton) {
                pauseResumeButton.classList.remove('hidden');
                pauseResumeButton.textContent = 'Pause';
                pauseResumeButton.disabled = false;
            }
            if(stopButton) {
                stopButton.classList.remove('hidden');
                stopButton.disabled = false;
            }

            if(progressContainer) progressContainer.classList.remove('hidden'); // Show progress area
            if(statusWrapper) statusWrapper.classList.remove('hidden'); // Ensure status is visible
            updateStatus('Starting image download process...', 'info');
            console.log("DEBUG: Starting image download loop...");
            startDownloadLoop(); // Initiate the asynchronous download loop
        } else {
            console.warn("Process button clicked but no data ready or button disabled.");
            updateStatus('Process a valid CSV file first.', 'warning');
        }
    }

    /* Handles clicks on the 'Save Cleaned CSV' button.*/
    function handleSaveCsvClick() {
        console.log(`DEBUG: Save CSV button clicked, disabled: ${saveCsvButton?.disabled}, data length: ${imageData.length}`);
        // Proceed only if button is enabled and there's data to save
        if (saveCsvButton && !saveCsvButton.disabled && imageData && imageData.length > 0) {
            updateStatus('Generating cleaned CSV file...', 'info');
            try {
                // Use originalHeaders to maintain column order and include all original columns
                const csvString = generateCsvString(imageData, originalHeaders);
                // Modify filename if the download was stopped partway
                const filenameSuffix = isStopped ? '_stopped' : '';
                const filename = `data_job_${getCurrentDate()}_cleaned${filenameSuffix}.csv`;
                downloadFile(csvString, filename);
                updateStatus(`Cleaned CSV "${filename}" downloaded.`, 'success');

                // Optionally disable/hide the save button after successful save
                // saveCsvButton.disabled = true;
                // saveCsvButton.classList.add('hidden');

            } catch(e) {
                updateStatus(`Error generating CSV: ${e.message}`, 'error');
                console.error("Error generating/downloading CSV:", e);
            }
        } else if (saveCsvButton && saveCsvButton.disabled) {
             updateStatus('Cannot save CSV while download is in progress or button is inactive.', 'warning');
        } else {
            updateStatus('No data available to save or button is not active.', 'warning');
        }
    }

    /* Handles clicks on the 'Pause' / 'Resume' button.*/
    function handlePauseResumeClick() {
        // Only toggle if the button is not disabled
        if (pauseResumeButton && !pauseResumeButton.disabled) {
            isPaused = !isPaused;
            if (isPaused) {
                pauseResumeButton.textContent = 'Resume';
                updateStatus('Download paused.', 'info');
                if(progressText) progressText.textContent += ' (Paused)'; // Append to progress text
            } else {
                pauseResumeButton.textContent = 'Pause';
                updateStatus('Download resumed.', 'info');
                // Optionally refresh progress text immediately (using current counts)
                const currentVal = downloadProgress ? downloadProgress.value : currentDownloadLoopIndex; // Use index as fallback
                const totalVal = downloadProgress ? downloadProgress.max : imageData.length;
                if (progressText) progressText.textContent = `(${currentVal}/${totalVal}) Processed | ${successCount} OK, ${errorCount} Errors`;
            }
        }
    }

    /* Handles clicks on the 'Stop' button.*/
    function handleStopClick() {
        // Only act if the button is not disabled
        if (stopButton && !stopButton.disabled) {
            isStopped = true; // Set the flag to signal the loop to stop
            isPaused = false; // Ensure pause is off so the loop can check the stop flag
            updateStatus('Stop requested... Finishing current operation.', 'warning');
            if(stopButton) stopButton.disabled = true; // Disable stop button immediately
            if(pauseResumeButton) {
                pauseResumeButton.disabled = true; // Disable pause/resume as well
                pauseResumeButton.textContent = 'Pause'; // Reset text
            }
            // The `startDownloadLoop` will detect `isStopped=true` and break, then call `resetUIDownloadFinished`.
        }
    }

    // ---- Event Listeners (Downloader Page) ----
    if (manualUploadTrigger && csvFileInput) {
        // Trigger file input when the manual trigger (e.g., a button) is clicked
        manualUploadTrigger.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault(); // Prevent potential default actions
            csvFileInput.value = null; // Reset input to allow selecting the same file again
            csvFileInput.click();
        });
    }
    if (dropZoneTarget) {
        // Prevent default drag behaviors
        dropZoneTarget.addEventListener('dragover', (e) => {
             e.stopPropagation();
             e.preventDefault();
             e.dataTransfer.dropEffect = 'copy'; // Show copy cursor
             dropZoneTarget.classList.add('hover'); // Add visual feedback
        });
        // Remove visual feedback when dragging leaves
        dropZoneTarget.addEventListener('dragleave', () => {
             dropZoneTarget.classList.remove('hover');
        });
        // Handle file drop
        dropZoneTarget.addEventListener('drop', (e) => {
             e.stopPropagation();
             e.preventDefault();
             dropZoneTarget.classList.remove('hover'); // Remove visual feedback
             if (e.dataTransfer.files.length > 0) {
                 handleFileSelect(e.dataTransfer.files[0]); // Process the first dropped file
             }
        });
    }
    if (csvFileInput) {
        // Handle file selection via the input element
        csvFileInput.addEventListener('change', (e) => {
             if (e.target.files.length > 0) {
                 handleFileSelect(e.target.files[0]);
             }
        });
    }
    // Attach handlers to action buttons
    if (processButton) processButton.addEventListener('click', handleProcessButtonClick);
    if (saveCsvButton) saveCsvButton.addEventListener('click', handleSaveCsvClick);
    if (pauseResumeButton) pauseResumeButton.addEventListener('click', handlePauseResumeClick);
    if (stopButton) stopButton.addEventListener('click', handleStopClick);

    // Initial UI reset when the page loads
    resetUIBeforeNewFile();

  } else {
    // Fallback for other pages (e.g., index.html)
    console.log("Initializing logic for a page other than file_download.html or get_images.html.");
    // No specific actions needed here based on the original code.
  }

}); // End DOMContentLoaded