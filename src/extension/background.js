// background.js (Service Worker) - Manages state, data, and communication.
// v7: Asynchronous CSV processing and status background update support.

// --- Global State (Managed by Service Worker) ---
let collectedData = [];         // Stores unique scraped items
let uploadedData = [];          // Stores raw uploaded items before processing for download
let processedUploadedDataInfo = null; // Stores { headers: [], actions: [], count: 0 } after upload processing
let isScraping = false;
let currentStatus = "Idle";
let readyContentScripts = new Set();

// --- Helper Functions --- (Keep existing helpers: log, deduplicateDataByOriginalURL, escapeCsvValueIfNeeded, alwaysQuoteCsvValue, generateCsvString, broadcastStatus)

/**
 * Logs a message from the background script with a standardized "[Background]" prefix at the specified log level.
 *
 * @param {'log' | 'warn' | 'error' | 'debug'} level - The console log level to use.
 * @param {...any} args - The message or data to log.
 */
function log(level, ...args) {
    console[level]("[Background]", ...args);
}

/**
 * Returns a new array containing only the first occurrence of each object in the input array, deduplicated by the `original_url` property.
 *
 * @param {Array<Object>} dataArray - Array of objects to deduplicate.
 * @returns {Array<Object>} Array of unique objects, each with a distinct `original_url`.
 *
 * @remark
 * Items without a valid `original_url` property are skipped and not included in the result.
 */
function deduplicateDataByOriginalURL(dataArray) {
    const uniqueMap = new Map();
    let skippedCount = 0;
    dataArray.forEach((item, index) => {
        if (item && typeof item === 'object' && item.original_url) {
            if (!uniqueMap.has(item.original_url)) {
                uniqueMap.set(item.original_url, item);
            } else { skippedCount++; }
        } else {
            log('warn', `Skipping invalid item or item missing/empty 'original_url' during deduplication (Index ${index}):`, item);
            skippedCount++;
        }
    });
    const uniqueData = Array.from(uniqueMap.values());
    log('log', `Deduplication based on 'original_url'. Input: ${dataArray.length}, Output: ${uniqueData.length}, Skipped: ${skippedCount}.`);
    return uniqueData;
}

/**
 * Escapes a value for inclusion in a CSV field, quoting only if the value contains commas, newlines, or double quotes.
 *
 * @param {*} field - The value to escape for CSV.
 * @returns {string} The escaped CSV field as a string.
 */
function escapeCsvValueIfNeeded(field) {
    if (field === null || field === undefined) { return '""'; }
    const stringField = String(field);
    if (stringField.includes(',') || stringField.includes('\n') || stringField.includes('"')) {
        return `"${stringField.replace(/"/g, '""')}"`;
    }
    return stringField;
}

/**
 * Converts a value to a CSV-safe string, always quoting and escaping as needed.
 *
 * Returns an empty quoted string for null or undefined values.
 *
 * @param {*} field - The value to convert for CSV output.
 * @returns {string} The value as a quoted and escaped CSV field.
 */
function alwaysQuoteCsvValue(field) {
    if (field === null || field === undefined) { return '""'; }
    const stringField = String(field);
    return `"${stringField.replace(/"/g, '""')}"`;
}


/**
 * Parses a single CSV line into an array of values, handling quoted fields and escaped quotes.
 *
 * @param {string} line - The CSV line to parse.
 * @returns {Array<string>} An array of parsed field values with quotes and escapes properly handled.
 */
function parseCsvLine(line) {
    const values = [];
    let currentVal = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                currentVal += '"'; i++;
            } else { inQuotes = !inQuotes; }
        } else if (char === ',' && !inQuotes) {
            values.push(currentVal); currentVal = '';
        } else { currentVal += char; }
    }
    values.push(currentVal);
    return values.map(val => {
        let finalVal = val.trim();
        if (finalVal.length >= 2 && finalVal.startsWith('"') && finalVal.endsWith('"')) {
            finalVal = finalVal.substring(1, finalVal.length - 1);
        }
        return finalVal.replace(/""/g, '"');
    });
}


/**
 * Extracts the filename with extension from a URL string, decoding any encoded characters.
 *
 * Returns null if the URL is invalid or no filename can be determined.
 *
 * @param {string} urlString - The URL to extract the filename from.
 * @returns {string|null} The decoded filename, or null if extraction fails.
 */
function extractFilenameFromUrl(urlString) {
    // This function implementation is based on the analysis and should be added
    // if not already present or updated if it exists with different logic.
    if (!urlString || typeof urlString !== 'string') return null;
    try {
        const url = new URL(urlString);
        const pathname = url.pathname;
        const lastSlashIndex = pathname.lastIndexOf('/');
        if (lastSlashIndex !== -1) {
            // Decode URI component in case of encoded characters
            return decodeURIComponent(pathname.substring(lastSlashIndex + 1));
        }
        // Fallback if no slash found (e.g., domain relative path)
        if (pathname) {
            return decodeURIComponent(pathname);
        }
    } catch (e) {
        console.warn(`Could not extract filename from URL: ${urlString}`, e.message);
    }
    return null;
}

/**
 * Modifies a filename by retaining only the parts before the third underscore, preserving the file extension.
 *
 * For example, "0_1_640_N.png" becomes "0_1.png". If the filename does not contain at least two underscores or lacks an extension, the original filename is returned unchanged.
 *
 * @param {string} originalFilename - The filename to modify.
 * @returns {string} The modified filename, or the original filename if the rule cannot be applied.
 */
function modifyFilenameForRule(originalFilename) {
    // This function implements the specific logic requested
    if (!originalFilename || typeof originalFilename !== 'string') {
        return originalFilename; // Return original if input is invalid
    }
    try {
        const lastDotIndex = originalFilename.lastIndexOf('.');
        if (lastDotIndex === -1 || lastDotIndex === 0) {
            // No extension or filename starts with a dot
            return originalFilename; // Cannot apply rule without extension separation
        }

        const namePart = originalFilename.substring(0, lastDotIndex);
        const extensionPart = originalFilename.substring(lastDotIndex); // Includes the dot

        const nameParts = namePart.split('_');

        // Check if we have at least 3 parts (to have parts before the third underscore)
        if (nameParts.length >= 3) {
            // Take the first two parts (indices 0 and 1)
            const newNamePart = nameParts.slice(0, 2).join('_');
            return newNamePart + extensionPart;
        } else {
            // Not enough underscores for the rule, return original filename
            return originalFilename;
        }
    } catch (e) {
        console.warn(`Error modifying filename "${originalFilename}": ${e.message}`);
        return originalFilename; // Return original on error
    }
}

/**
 * Generates a CSV string from either scraped or uploaded data, applying optional filters and formatting.
 *
 * For scraped data, inserts a 'download_url' column after 'url', where the filename is modified according to a specific rule. For uploaded data, supports filtering by URL column, action values, and row limit before generating the CSV.
 *
 * @param {Object} options - Configuration for CSV generation.
 * @param {'scraper' | 'upload'} options.source - Selects the data source: scraped or uploaded.
 * @param {Array<string>} [options.actionFilters] - Optional list of action values to filter uploaded data.
 * @param {number|null} [options.limit] - Optional maximum number of rows to include (for uploaded data).
 * @param {string} [options.urlColumn] - Name of the URL column to filter uploaded data.
 * @returns {string} The generated CSV content as a string, including a BOM.
 *
 * @remark
 * Returns only the BOM if no data or headers are available for the selected source.
 */
function generateCsvString(options) {
    const source = options.source;
    const { actionFilters, limit, urlColumn } = options;

    let dataToProcess = [];
    let headersToUse = [];
    const URL_COLUMN_NAME = 'url';
    const DOWNLOAD_URL_COLUMN_NAME = 'download_url';

    if (source === 'scraper') {
        if (!collectedData || collectedData.length === 0) {
            log('warn', "generateCsvString (scraper) called but collectedData is empty.");
            return '';
        }
        dataToProcess = collectedData;

        let baseHeaders = ['job_id', URL_COLUMN_NAME, 'prompt', 'action'];
        const sortedParamNames = Array.from(collectedParams || new Set()).sort();
        let combinedHeaders = [...baseHeaders, ...sortedParamNames];
        const urlIndex = combinedHeaders.indexOf(URL_COLUMN_NAME);

        if (urlIndex > -1) {
            combinedHeaders.splice(urlIndex + 1, 0, DOWNLOAD_URL_COLUMN_NAME);
        } else {
            const promptIndex = combinedHeaders.indexOf('prompt');
            if (promptIndex > -1) { combinedHeaders.splice(promptIndex, 0, DOWNLOAD_URL_COLUMN_NAME); }
            else { combinedHeaders.push(DOWNLOAD_URL_COLUMN_NAME); }
        }
        headersToUse = combinedHeaders;
        log('log', 'SCRAPER CSV: Using scraped data. Final CSV Headers:', headersToUse);

    } else if (source === 'upload') {
        if (!uploadedData || uploadedData.length === 0 || !processedUploadedDataInfo || !processedUploadedDataInfo.headers) {
            log('warn', `generateCsvString (upload) called but data/info or headers are missing.`);
            return "\uFEFF"; // Nur BOM zurückgeben, um leere Datei, aber keinen Fehler zu signalisieren
        }

        let filteredData = [...uploadedData];
        const selectedUrlColumnName = urlColumn;

        if (selectedUrlColumnName) {
            if (processedUploadedDataInfo.validUrlHeaders &&
                !processedUploadedDataInfo.validUrlHeaders.includes(selectedUrlColumnName)) {
                log('warn', `UPLOAD CSV: Selected URL column '${selectedUrlColumnName}' is not in validUrlHeaders.`);
            }
            filteredData = filteredData.filter(row => {
                if (row && Object.hasOwn(row, selectedUrlColumnName)) {
                    const value = String(row[selectedUrlColumnName]);
                    return value.startsWith('http://') || value.startsWith('https://');
                }
                return false;
            });
            log('log', `UPLOAD CSV: Step 1 - Filtered by valid URLs in column '${selectedUrlColumnName}'. ${filteredData.length} items remain.`);
        } else {
            log('warn', 'UPLOAD CSV: Step 1 - No URL column provided for pre-filtering.');
        }

        const actionColumnKey = 'action';
        if (actionFilters && actionFilters.length > 0 && filteredData.length > 0) {
            if (Object.hasOwn(filteredData[0], actionColumnKey)) {
                filteredData = filteredData.filter(item => {
                    return item && Object.hasOwn(item, actionColumnKey) && actionFilters.includes(item[actionColumnKey]);
                });
                log('log', `UPLOAD CSV: Step 2 - Action filters applied. ${filteredData.length} items remain.`);
            } else {
                log('warn', `UPLOAD CSV: Step 2 - Action column '${actionColumnKey}' not found in data. Action filters skipped.`);
            }
        }

        if (limit && limit > 0 && limit < filteredData.length) {
            filteredData = filteredData.slice(0, limit);
            log('log', `UPLOAD CSV: Step 3 - Max Rows limit (${limit}) applied. ${filteredData.length} items remain.`);
        }

        dataToProcess = filteredData;

        if (dataToProcess.length === 0) {
            log('warn', `UPLOAD CSV: After all filters and limits, no data remains for CSV export.`);
        }
        headersToUse = processedUploadedDataInfo.headers;
        log('log', 'UPLOAD CSV: Using filtered and limited uploaded data. Final CSV Headers:', headersToUse);
    } else {
        log('error', `generateCsvString called with invalid source: ${source}`);
        return '';
    }

    if (dataToProcess.length === 0 && (!headersToUse || headersToUse.length === 0)) {
        log('warn', `No data and no headers for source '${source}'. Returning empty CSV content (BOM only).`);
        return "\uFEFF";
    }

    const headerRow = headersToUse.map(header => escapeCsvValueIfNeeded(header)).join(',');
    const dataRows = dataToProcess.map((row, rowIndex) => {
        if (!row || typeof row !== 'object') {
            log('warn', `Skipping invalid row object at index ${rowIndex} (Source: ${source}).`);
            return '';
        }
        return headersToUse.map(header => {
            let value = '';
            try {
                if (header === DOWNLOAD_URL_COLUMN_NAME && source === 'scraper') {
                    const originalUrl = row[URL_COLUMN_NAME];
                    if (originalUrl && typeof originalUrl === 'string') {
                        const originalFilename = extractFilenameFromUrl(originalUrl);
                        if (originalFilename) {
                            const modifiedFilename = modifyFilenameForRule(originalFilename);
                            const lastSlashIndex = originalUrl.lastIndexOf('/');
                            if (lastSlashIndex > -1) {
                                value = originalUrl.substring(0, lastSlashIndex + 1) + modifiedFilename;
                            } else {
                                value = modifiedFilename;
                            }
                        } else {
                            value = originalUrl;
                        }
                    }
                } else if (source === 'scraper' && row.jobParams && Object.hasOwn(row.jobParams, header)) {
                    value = row.jobParams[header];
                } else if (Object.hasOwn(row, header)) {
                    value = row[header];
                }
            } catch (accessError) {
                log('error', `Error accessing property '${header}' on row ${rowIndex} (Source: ${source}):`, accessError);
                value = 'ACCESS_ERROR';
            }
            return (header === 'prompt') ? alwaysQuoteCsvValue(value) : escapeCsvValueIfNeeded(value);
        }).join(',');
    }).filter(rowString => rowString !== '');

    const bom = "\uFEFF";
    if (dataRows.length === 0 && dataToProcess.length > 0) {
        log('warn', 'CSV: No valid data rows after mapping, though dataToProcess was not empty.');
    }

    const csvContent = bom + headerRow + (dataRows.length > 0 ? '\n' + dataRows.join('\n') : '');
    log('log', `Generated CSV: ${dataRows.length} data rows for source '${source}'. Length: ${csvContent.length}`);
    return csvContent;
}


/**
 * Broadcasts the current scraping or upload status to the popup UI.
 *
 * Sends a message containing the current operation status, data counts, running state, and upload information (if available) to the popup. Handles cases where the popup is not open without interrupting execution.
 */
function broadcastStatus() {
    const statusPayload = {
        action: "update-status",
        // Determine source based on state
        source: (processedUploadedDataInfo && processedUploadedDataInfo.count > 0) ? 'upload' : 'scraper',
        status: currentStatus,
        count: (processedUploadedDataInfo && processedUploadedDataInfo.count > 0) ? processedUploadedDataInfo.count : collectedData.length,
        isRunning: isScraping,
        hasData: collectedData.length > 0 || (processedUploadedDataInfo && processedUploadedDataInfo.count > 0),
        // Optionally include processed upload info if relevant
        ...(processedUploadedDataInfo && { // Conditionally spread properties if info exists
            uploadStatus: currentStatus, // Or a specific upload status?
            uploadDataCount: processedUploadedDataInfo.count,
            // headers: processedUploadedDataInfo.headers, // Avoid sending large arrays repeatedly?
            // actions: processedUploadedDataInfo.actions
        })
    };
    log('debug', "Broadcasting status to popup:", statusPayload);
    chrome.runtime.sendMessage(statusPayload).catch(error => {
        if (!error.message.includes("Could not establish connection") && !error.message.includes("Receiving end does not exist")) {
            log('warn', "Error broadcasting status (popup might be closed or other issue):", error.message);
        }
    });
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('debug', `Received message: Action = ${message.action} from ${sender.tab ? 'Tab ID ' + sender.tab.id : 'Popup/Other'}`);
    let isAsyncResponse = false;

    switch (message.action) {
        case "get-status":
            sendResponse({
                status: currentStatus,
                count: collectedData.length,
                isRunning: isScraping,
                hasData: collectedData.length > 0,
                uploadData: processedUploadedDataInfo
            });
            break;

        case "content_script_ready":
            if (sender.tab && sender.tab.id) {
                log('log', `Content script in tab ${sender.tab.id} reported ready.`);
                readyContentScripts.add(sender.tab.id);
            } else {
                log('warn', "Received 'content_script_ready' but sender tab ID is missing.");
            }
            break;

        case "check_content_script_ready":
            if (message.tabId) {
                const isReady = readyContentScripts.has(message.tabId);
                log('log', `Checking readiness for tab ${message.tabId}: ${isReady}`);
                sendResponse({ isReady: isReady });
            } else {
                log('warn', "Received 'check_content_script_ready' but message.tabId is missing.");
                sendResponse({ isReady: false, error: "tabId missing" });
            }
            break;

        case "process-uploaded-csv":
            log('log', "Received request to process uploaded CSV.");
            isAsyncResponse = true;
            uploadedData = [];
            processedUploadedDataInfo = null;

            try {
                sendResponse({ status: "processing_started" });
            } catch (e) {
                log('warn', "Could not send 'processing_started' immediately.", e.message);
            }

            (async () => {
                let responsePayload = { action: "upload_processed_result" };
                try {
                    if (!message.content || typeof message.content !== 'string' || message.content.trim() === '') {
                        throw new Error("No CSV content received or content is empty.");
                    }
                    const lines = message.content.split(/\r?\n/);
                    if (lines.length < 1) throw new Error("CSV content has no lines.");

                    const headerLine = lines[0].trim();
                    const rawHeaders = parseCsvLine(headerLine);
                    if (rawHeaders.length === 0 || rawHeaders.every(h => !h || h.trim() === '')) {
                        throw new Error("No valid headers found in CSV.");
                    }
                    const headers = rawHeaders.map(h => h.trim()); // Trim headers

                    uploadedData = [];
                    for (let i = 1; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (line === '') continue;
                        const values = parseCsvLine(line);
                        if (values.length > 0 && values.some(val => val && val.trim() !== '')) {
                            const rowObject = {};
                            headers.forEach((header, index) => { // Use trimmed headers
                                if (header.length > 0) { // Ensure header itself is not empty after trim
                                    rowObject[header] = index < values.length ? values[index] : undefined;
                                }
                            });
                            if (Object.keys(rowObject).length > 0) {
                                uploadedData.push(rowObject);
                            }
                        }
                    }
                    log('log', `Parsed ${uploadedData.length} data rows from uploaded CSV.`);
                    const totalRows = uploadedData.length;

                    let validUrlHeaders = [];
                    if (headers.length > 0 && totalRows > 0) {
                        validUrlHeaders = headers.filter(header => {
                            if (!header) return false; // Already trimmed
                            const rowsToScan = Math.min(totalRows, 20);
                            for (let i = 0; i < rowsToScan; i++) {
                                const item = uploadedData[i];
                                if (item && Object.hasOwn(item, header)) {
                                    const value = String(item[header]);
                                    if (value.startsWith('http://') || value.startsWith('https://')) {
                                        return true;
                                    }
                                }
                            }
                            return false;
                        });
                    }
                    log('log', `Found valid URL headers: [${validUrlHeaders.join(', ')}]`);

                    const urlCountsPerColumn = {};
                    if (totalRows > 0) {
                        validUrlHeaders.forEach(validHeader => {
                            let count = 0;
                            uploadedData.forEach(item => {
                                if (item && Object.hasOwn(item, validHeader)) {
                                    const value = String(item[validHeader]);
                                    if (value.startsWith('http://') || value.startsWith('https://')) {
                                        count++;
                                    }
                                }
                            });
                            urlCountsPerColumn[validHeader] = count;
                        });
                    }
                    log('log', 'URL counts per valid column:', urlCountsPerColumn);

                    const actionsSet = new Set();
                    const actionColumnKey = 'action';
                    if (headers.includes(actionColumnKey)) {
                        uploadedData.forEach(item => {
                            if (item && item[actionColumnKey] && typeof item[actionColumnKey] === 'string' && item[actionColumnKey].trim() !== '') {
                                actionsSet.add(item[actionColumnKey].trim());
                            }
                        });
                    } else {
                        log('warn', `Action column ('${actionColumnKey}') not found in uploaded CSV headers.`);
                    }

                    processedUploadedDataInfo = {
                        headers: headers, // Use trimmed headers
                        validUrlHeaders: validUrlHeaders,
                        urlCountsPerColumn: urlCountsPerColumn,
                        totalRows: totalRows,
                        actions: Array.from(actionsSet).sort(),
                        count: totalRows
                    };
                    responsePayload.status = 'success';
                    responsePayload.result = processedUploadedDataInfo;
                    currentStatus = `Processed ${processedUploadedDataInfo.count} CSV rows`;
                } catch (error) {
                    log('error', "Error processing uploaded CSV:", error);
                    responsePayload.status = 'error';
                    responsePayload.message = error.message || "Unknown CSV processing error.";
                    currentStatus = "Upload Processing Error";
                    processedUploadedDataInfo = null;
                    uploadedData = [];
                } finally {
                    log('debug', "Sending upload processed result to all listeners:", responsePayload);
                    chrome.runtime.sendMessage(responsePayload).catch(e => {
                        if (!e.message.includes("Could not establish connection") && !e.message.includes("Receiving end does not exist")) {
                            log('warn', "Error sending 'upload_processed_result' message:", e.message);
                        }
                    });
                    broadcastStatus();
                }
            })();
            return true; // Keep channel open for async IIFE

        case "download-csv": // Primarily for Scraper CSV, or Upload CSV as fallback
            isAsyncResponse = true; // FileReader and chrome.downloads are async
            const csvDownloadOptions = message.options || {};
            const csvSource = csvDownloadOptions.source || 'scraper';
            log('log', `CSV Download request for source: ${csvSource}`, csvDownloadOptions);

            let csvDataAvailable = false;
            if (csvSource === 'scraper' && collectedData && collectedData.length > 0) {
                csvDataAvailable = true;
            } else if (csvSource === 'upload' && uploadedData && uploadedData.length > 0 && processedUploadedDataInfo) {
                csvDataAvailable = true;
            }

            if (!csvDataAvailable) {
                log('warn', `CSV Download: No initial data for source '${csvSource}'.`);
                currentStatus = `Idle - No data for ${csvSource} CSV`;
                broadcastStatus();
                sendResponse({ status: "no_data", message: `No initial data for ${csvSource} CSV.` });
                break;
            }

            currentStatus = `Generating ${csvSource === 'upload' ? 'Upload Data' : 'Scraper'} CSV...`;
            broadcastStatus();

            try {
                const csvContent = generateCsvString(csvDownloadOptions);
                const contentToCheck = csvContent.replace("\uFEFF", "").trim();
                const linesInCsv = contentToCheck.split('\n');
                const headersOnlyInCsv = linesInCsv.length === 1 && (processedUploadedDataInfo?.headers?.join(',') === linesInCsv[0] || collectedParams?.size > 0);


                if (!contentToCheck || (linesInCsv.length <= 1 && !headersOnlyInCsv && linesInCsv[0].trim() === '')) {
                    log('warn', `CSV content for '${csvSource}' is effectively empty. No download.`);
                    currentStatus = "Idle - No data after filtering";
                    broadcastStatus();
                    sendResponse({ status: "no_data", message: "No data for CSV after filtering." });
                    return isAsyncResponse;
                }

                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const reader = new FileReader();

                reader.onload = function () {
                    const dataUrl = reader.result;
                    const now = new Date();
                    const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
                    const filename = `midjourney_export_${csvSource}_${dateStr}.csv`;

                    chrome.downloads.download({
                        url: dataUrl,
                        filename: filename,
                        saveAs: true
                    }).then((downloadId) => {
                        if (downloadId) {
                            log('log', `CSV Download started (ID: ${downloadId}) for ${csvSource}.`);
                            currentStatus = "Idle";
                            sendResponse({ status: "download_started", message: "CSV Download gestartet." });
                        } else {
                            log('warn', `CSV Download failed to start (no ID) for ${csvSource}. User might have cancelled.`);
                            currentStatus = "Download Failed";
                            sendResponse({ status: "error", message: "CSV Download failed or cancelled." });
                        }
                        broadcastStatus();
                    }).catch(error => {
                        log('error', `Error in chrome.downloads.download for ${csvSource} CSV:`, error);
                        currentStatus = "Download Error";
                        broadcastStatus();
                        sendResponse({ status: "error", message: error.message });
                    });
                };
                reader.onerror = function () {
                    log('error', 'FileReader error for CSV:', reader.error);
                    currentStatus = "Download Prep Error";
                    broadcastStatus();
                    sendResponse({ status: "error", message: `FileReader error: ${reader.error.message || 'Unknown'}` });
                };
                reader.readAsDataURL(blob);
            } catch (error) {
                log('error', `Synchronous error during CSV prep for ${csvSource}:`, error);
                currentStatus = "Download Prep Error";
                broadcastStatus();
                try { sendResponse({ status: "error", message: `CSV preparation failed: ${error.message}` }); }
                catch (e) { log('error', "Failed to send error for sync CSV prep error", e); }
            }
            break;

        case "start-image-download":
            isAsyncResponse = true;
            const imageOptions = message.options || {};
            log('log', `Image download request with options:`, imageOptions);

            if (!uploadedData || uploadedData.length === 0 || !processedUploadedDataInfo) {
                log('warn', "Image download: No uploaded data.");
                sendResponse({ status: "no_data", message: "No uploaded data for image download." });
                break;
            }
            const selectedUrlColImg = imageOptions.urlColumn;
            if (!selectedUrlColImg) {
                log('error', "Image download: No URL column specified.");
                sendResponse({ status: "error", message: "URL column not specified for images." });
                break;
            }

            // Filterlogik bleibt unverändert
            let imagesToDownload = [...uploadedData].filter(row => {
                if (row && Object.hasOwn(row, selectedUrlColImg)) {
                    const value = String(row[selectedUrlColImg]);
                    return value.startsWith('http://') || value.startsWith('https://');
                }
                return false;
            });
            const actionColKeyImg = 'action';
            if (imageOptions.actionFilters && imageOptions.actionFilters.length > 0 && Object.hasOwn(imagesToDownload[0], actionColKeyImg)) {
                imagesToDownload = imagesToDownload.filter(item =>
                    item && Object.hasOwn(item, actionColKeyImg) && imageOptions.actionFilters.includes(item[actionColKeyImg])
                );
            }
            if (imageOptions.limit && imageOptions.limit > 0 && imageOptions.limit < imagesToDownload.length) {
                imagesToDownload = imagesToDownload.slice(0, imageOptions.limit);
            }

            if (imagesToDownload.length === 0) {
                log('warn', "Image download: No images after filtering.");
                sendResponse({ status: "no_data", message: "No images match criteria." });
                break;
            }

            // *** BEGINN DER NEUEN, KORRIGIERTEN DOWNLOAD-LOGIK ***

            // Anonyme asynchrone Funktion, um 'await' nutzen zu können
            (async () => {
                let successCount = 0;
                let failureCount = 0;
                const totalToDownload = imagesToDownload.length;

                currentStatus = `Starte Download von ${totalToDownload} Bildern...`;
                broadcastStatus();
                try {
                    sendResponse({ status: "image_downloads_initiated", message: `Starte Download von ${totalToDownload} Bildern...`, totalToDownload: totalToDownload });
                } catch (e) {
                    log('warn', 'sendResponse für image_downloads_initiated fehlgeschlagen (Popup evtl. schon zu)');
                }

                // SEQUENZIELLE SCHLEIFE: Behebt das Stottern und ermöglicht Live-Feedback
                for (const [index, row] of imagesToDownload.entries()) {
                    let finalFilename = null;

                    // ROBUSTE DATEINAMEN-LOGIK: Behebt das .txt-Problem
                    try {
                        const imageUrl = row[selectedUrlColImg];
                        const urlObj = new URL(imageUrl);
                        const originalFilename = decodeURIComponent(urlObj.pathname.substring(urlObj.pathname.lastIndexOf('/') + 1).split('?')[0]);

                        if (originalFilename && originalFilename.includes('.')) {
                            const lastDotIndex = originalFilename.lastIndexOf('.');
                            const nameStem = originalFilename.substring(0, lastDotIndex);
                            const nameExtension = originalFilename.substring(lastDotIndex);
                            const stemParts = nameStem.split('_');
                            let modifiedStem = nameStem;
                            if (stemParts.length >= 3) {
                                modifiedStem = stemParts.slice(0, 2).join('_');
                            }
                            const modifiedFilename = modifiedStem + nameExtension;
                            const jobId = row['job_id'] || '';
                            finalFilename = `${jobId}_${modifiedFilename}`;
                        } else {
                            log('error', `Konnte keinen Dateinamen mit Endung aus der URL extrahieren, überspringe: ${imageUrl}`);
                            failureCount++;
                            continue; // Nächste Iteration
                        }
                    } catch (e) {
                        log('error', `Fehler bei URL-Verarbeitung, überspringe: ${row[selectedUrlColImg]}`, e);
                        failureCount++;
                        continue; // Nächste Iteration
                    }

                    // Status-Update VOR jedem Download
                    currentStatus = `(${index + 1}/${totalToDownload}) Wird heruntergeladen...`;
                    broadcastStatus({ currentItem: finalFilename });

                    try {
                        // 'await' stellt sicher, dass ein Download abgeschlossen ist, bevor der nächste startet
                        const downloadId = await chrome.downloads.download({
                            url: row[selectedUrlColImg],
                            filename: finalFilename.replace(/__+/g, '_')
                        });
                        if (downloadId) { successCount++; } else { failureCount++; }
                    } catch (err) {
                        failureCount++;
                        log('error', `Fehler beim Download von ${finalFilename}:`, err.message || err);
                    }
                }

                // Finaler Status
                currentStatus = `Download abgeschlossen: ${successCount}/${totalToDownload} erfolgreich.`;
                broadcastStatus({ currentItem: null });
            })();
            break;

        case "content-status-update":
            isScraping = message.isRunning;
            currentStatus = message.status;
            broadcastStatus();
            break;

        case "scraped-data":
            if (message.data && message.data.length > 0) {
                const combinedData = [...collectedData, ...message.data];
                collectedData = deduplicateDataByOriginalURL(combinedData);
            }
            if (message.params && Array.isArray(message.params)) {
                message.params.forEach(param => (collectedParams || (collectedParams = new Set())).add(param));
            }
            currentStatus = isScraping ? "Running..." : "Processing Data...";
            broadcastStatus();
            sendResponse({ received: true });
            break;

        case "clear-data":
            log('log', "Clearing collected SCRAPED data and params.");
            collectedData = [];
            collectedParams = new Set();
            currentStatus = "Idle";
            if (isScraping) { // Wenn Scraping lief, setze es zurück
                isScraping = false;
                // Sende Stopp-Signal an Content-Script, falls es noch aktiv sein könnte (optional, aber sauber)
                chrome.tabs.query({ active: true, url: "*://*.midjourney.com/*" }, (tabs) => {
                    if (tabs && tabs.length > 0) {
                        chrome.tabs.sendMessage(tabs[0].id, { action: "stop-scraping" }).catch(e => log('warn', 'Failed to send stop-scraping on clear-data', e.message));
                    }
                });
            }
            broadcastStatus();
            sendResponse({ cleared: true });
            break;

        default:
            log('warn', `Unknown message action received: ${message.action}`);
            break;
    }
    return isAsyncResponse;
});

// -- Clean status when tabs are closed --
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    if (readyContentScripts.has(tabId)) {
        log('log', `Tab ${tabId} closed, removing from ready set.`);
        readyContentScripts.delete(tabId);
    }
});

// -- Clean navigation (complex if page reloads) --
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Wenn die URL sich ändert *und* nicht mehr zur Midjourney Imagine Seite passt ODER der Status "loading" ist
    const targetUrlPattern = /https?:\/\/www\.midjourney\.com\/imagine/i;
    if (changeInfo.status === 'loading' || (changeInfo.url && !targetUrlPattern.test(changeInfo.url))) {
        if (readyContentScripts.has(tabId)) {
            log('log', `Tab ${tabId} navigated or reloaded, removing from ready set (will re-add on ready).`);
            readyContentScripts.delete(tabId);
        }
    }
});

// --- Service Worker Lifecycle Events --- (Keep existing onInstalled, onStartup)
chrome.runtime.onInstalled.addListener(() => {
    log('log', 'Extension installed or updated. Initializing state.');
    collectedData = []; collectedParams = new Set(); isScraping = false; currentStatus = "Idle"; uploadedData = []; processedUploadedDataInfo = null;
    readyContentScripts = new Set(); // <<-- Diese Zeile hinzufügen
});

chrome.runtime.onStartup.addListener(() => {
    log('log', 'Browser startup detected. Resetting extension state.');
    collectedData = []; collectedParams = new Set(); isScraping = false; currentStatus = "Idle"; uploadedData = []; processedUploadedDataInfo = null;
    readyContentScripts = new Set(); // <<-- Diese Zeile hinzufügen
});

log('log', 'Background service worker started successfully.');