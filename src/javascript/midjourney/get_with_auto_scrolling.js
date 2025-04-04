/*
 * Auto-Scrolling Midjourney Exporter
 *
 * Purpose: Automatically scrolls down the Midjourney page (targeting #pageScroll),
 *          scrapes job data (prompt, parameters, image URL) as it loads,
 *          and downloads it as a CSV file upon completion or manual stop.
 * Usage:   1. Navigate to your Midjourney job history page (e.g., Archive).
 *          2. Paste this entire script into the browser's developer console (F12).
 *          3. Run `midjourneyExporter.start()` in the console to begin scrolling and scraping.
 *          4. Run `midjourneyExporter.stop()` to halt the process manually (CSV will be generated).
 *          5. Optionally, run `midjourneyExporter.generate()` after stopping if needed.
 * Notes:   - DOM selectors may need updates if Midjourney changes its website structure.
 *          - Relies on finding a scrollable element with ID #pageScroll.
 *          - Has safety limits for iterations and checks to prevent infinite loops.
 */

(function() {
    'use strict';

    // ---- Configuration ----

    const CONFIG = {
        scrollElementSelector: "#pageScroll", // The element that needs scrolling
        waitAfterScrollMs: 1500,       // Time to wait for content to load after scrolling
        scrollAmountFactor: 0.8,      // How much of the viewport height to scroll each time
        maxChecksWithoutNew: 10,       // Stop if no new items found for this many consecutive checks (when scroll height is stable)
        maxChecksNearScrollEnd: 5,    // Stop if near scroll end and no new items found for this many checks
        maxIterations: 5000,          // Safety limit to prevent infinite loops
        loopIntervalMs: 100,          // Short delay between loop checks after waiting period
        csvFilenamePrefix: 'midjourney_auto_export_',
        logPrefix: '[Exporter Auto]',
        debugLog: false                // Set to true for more verbose console output
    };

    const SELECTORS = {
        jobContainer: 'div.absolute.flex-col.grid[class*="grid-cols"]', // Main container for a job/grid
        promptWrapper: 'div.relative.group\\/promptText', // Primary prompt location
        promptSpan: 'span.relative',                   // Span inside the primary wrapper
        promptFallback: 'div.overflow-clip.flex.relative span.relative', // Fallback prompt location
        paramsContainer: 'div.flex.flex-wrap.gap-1.empty\\:hidden', // Container for parameter buttons
        paramButton: 'button',                            // Buttons holding parameters
        paramNameSpan: 'span.opacity-80 > span.opacity-80', // Inner span containing the parameter name (e.g., "--ar")
        paramValueSibling: 'span:not(.opacity-80)',      // Potential sibling span containing part of the value
        imageGrid: 'div.grid.gap-\\[1px\\], div.grid.lg\\:gap-2', // Container for the image(s)
        imageLink: 'div.relative.group > a',             // Link surrounding the image
        imageElement: 'img[src*="cdn.midjourney.com/"]', // The actual image element
    };

    const DEFAULT_VALUES = {
        prompt: 'PROMPT_NOT_FOUND',
        jobId: 'ID_NOT_FOUND',
        pngSrc: 'NO_IMAGE_SRC',
    };

    // ---- State Variables ----

    let scrollTimeoutId = null;
    let loopTimeoutId = null;
    let processedContainerTops = new Set(); // Tracks containers by their 'top' style property
    let allParamNames = new Set();          // Unique parameter names found
    let intermediateData = [];              // Stores extracted {jobId, pngSrc, prompt, jobParams}
    let consecutiveNoNewElements = 0;
    let currentIteration = 0;
    let isRunning = false;
    let scrollableElement = null;           // The DOM element to scroll
    let lastScrollHeight = 0;               // Track scroll height between iterations

    // ---- Helper Functions ----

    /**
     * Logs messages to the console, prefixed consistently.
     * @param {string} level - 'log', 'warn', 'error', 'debug'
     * @param {...any} args - Messages or objects to log
     */
    function log(level, ...args) {
        const prefix = CONFIG.logPrefix;
        if (level === 'debug' && !CONFIG.debugLog) {
            return; // Skip debug logs if disabled
        }
        console[level](prefix, ...args);
    }

    /**
     * Creates a CSV file from a string and initiates download.
     * @param {string} csvContent - The CSV data as a single string.
     * @param {string} filename - The desired name for the downloaded file.
     */
    function downloadCSV(csvContent, filename) {
        // UTF-8 BOM for Excel
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');

        downloadLink.style.display = 'none';
        downloadLink.href = url;
        downloadLink.download = filename;

        document.body.append(downloadLink);
        downloadLink.click();

        downloadLink.remove();
        window.URL.revokeObjectURL(url);
        log('log', `Download initiated for: ${filename}`);
    }

    /**
     * Escapes a string for use in a CSV field according to RFC 4180.
     * @param {string|number|null|undefined} field - The value to escape.
     * @returns {string} The escaped string, ready for CSV.
     */
    function escapeCsvField(field) {
        if (field === null || field === undefined) {
            return '""';
        }
        const stringField = String(field);
        return `"${stringField.replace(/"/g, '""')}"`;
    }

    // ---- Data Extraction (Processing a Single Container) ----

    /**
     * Extracts data from a single job container and updates shared state.
     * @param {Element} jobContainer - The DOM element of the job container.
     * @param {string} containerId - A unique identifier for this container (usually style.top or a generated fallback).
     */
    function processContainer(jobContainer, containerId) {
        log('debug', `Processing NEW container with ID: ${containerId}`);
        processedContainerTops.add(containerId); // Mark as processed

        // ---- Extract Prompt ----
        const promptWrapper = jobContainer.querySelector(SELECTORS.promptWrapper);
        let promptText = DEFAULT_VALUES.prompt;
        if (promptWrapper) {
            promptText = promptWrapper.querySelector(SELECTORS.promptSpan)?.textContent?.trim() ?? promptText;
        } else {
            // Fallback
            promptText = jobContainer.querySelector(SELECTORS.promptFallback)?.textContent?.trim() ?? promptText;
        }

        // ---- Extract Parameters ----
        const jobParams = {};
        const potentialParamsContainers = Array.from(jobContainer.querySelectorAll(SELECTORS.paramsContainer));
        const paramsContainer = potentialParamsContainers.find(container => container.querySelector(SELECTORS.paramButton));

        if (paramsContainer) {
            const buttons = paramsContainer.querySelectorAll(SELECTORS.paramButton);
            buttons.forEach(button => {
                const nameSpan = button.querySelector(SELECTORS.paramNameSpan);
                if (!nameSpan) return;

                const paramName = nameSpan.textContent?.trim();
                if (!paramName) return;

                let paramValue = '';
                let currentNode = nameSpan.nextSibling;
                while (currentNode) {
                    if (currentNode.nodeType === Node.TEXT_NODE) {
                        paramValue += currentNode.textContent.trim();
                    } else if (currentNode.nodeType === Node.ELEMENT_NODE && currentNode.matches(SELECTORS.paramValueSibling)) {
                        paramValue += currentNode.textContent.trim();
                    }
                    currentNode = currentNode.nextSibling;
                }
                paramValue = paramValue.trim();

                if (!paramValue) { paramValue = "true"; } // Handle flag parameters

                allParamNames.add(paramName); // Add to global set
                jobParams[paramName] = paramValue;
            });
        }

        // ---- Extract Images and Store Data ----
        const imageGridContainer = jobContainer.querySelector(SELECTORS.imageGrid);
        let processedImage = false;
        if (imageGridContainer) {
            const imageLinks = imageGridContainer.querySelectorAll(SELECTORS.imageLink);
            imageLinks.forEach(link => {
                const imgElement = link.querySelector(SELECTORS.imageElement);
                const src = imgElement?.getAttribute('src');
                if (!src) return;

                const jobIdMatch = src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\//i);
                const jobId = jobIdMatch?.[1] ?? DEFAULT_VALUES.jobId;
                const pngSrc = src.split('?')[0]?.replace(/\.webp$/i, '.png') ?? DEFAULT_VALUES.pngSrc;

                // Store raw data; escaping happens during final CSV generation
                intermediateData.push({ jobId, pngSrc, prompt: promptText, jobParams });
                processedImage = true;
            });
        }

        // Handle cases with parameters but no image found
        if (!processedImage && Object.keys(jobParams).length > 0) {
            log('warn', `Job Container with params but no image found (ID: ${containerId}). Storing entry.`);
            intermediateData.push({
                jobId: DEFAULT_VALUES.jobId,
                pngSrc: DEFAULT_VALUES.pngSrc,
                prompt: promptText,
                jobParams
            });
        }
    }

    // ---- CSV Generation ----

    /**
     * Generates the final CSV content from intermediateData and initiates download.
     */
    function generateFinalCsv() {
        log('debug', 'generateFinalCsv() called.');
        log('debug', `generateFinalCsv: intermediateData contains ${intermediateData.length} entries.`);

        if (intermediateData.length === 0) {
            alert('No data collected to export.');
            log('error', "No data collected. Cannot generate CSV.");
            return;
        }

        log('debug', `Found unique parameter names: ${Array.from(allParamNames).join(', ')}`);
        const csvRows = [];
        const sortedParamNames = Array.from(allParamNames).sort();
        const header = ['job_id', 'url', 'prompt', ...sortedParamNames];

        log('debug', `Final CSV Header: ${header.join(', ')}`);
        csvRows.push(header.map(escapeCsvField).join(',')); // Add escaped header row

        intermediateData.forEach(entry => {
            const rowData = [
                escapeCsvField(entry.jobId),
                escapeCsvField(entry.pngSrc),
                escapeCsvField(entry.prompt), // Escape prompt here
            ];
            const paramValues = sortedParamNames.map(colName => {
                const value = entry.jobParams[colName];
                return escapeCsvField(value ?? ''); // Escape each parameter value
            });
            csvRows.push([...rowData, ...paramValues].join(','));
        });

        log('debug', `generateFinalCsv: finalResults contains ${csvRows.length} rows (including header).`);

        if (csvRows.length > 1) {
            const finalCSV = csvRows.join('\n');
            const filename = `${CONFIG.csvFilenamePrefix}${new Date().toISOString().slice(0, 10)}.csv`;
            log('debug', `Attempting to download CSV with ${csvRows.length - 1} data rows.`);
            downloadCSV(finalCSV, filename);
            log('log', `Exported ${intermediateData.length} data entries.`);
        } else {
            alert('Error creating CSV data or no data available after header.');
            log('error', "Error during final CSV generation or no data rows in finalResults.");
        }
    }


    // ---- Auto-Scrolling Core Loop ----

    /**
     * The main loop that scrolls, waits, processes, and checks stop conditions.
     */
    function scrollAndProcessLoop() {
        if (!isRunning || !scrollableElement) {
            log('debug', "Loop check: Stopping (isRunning false or scrollableElement missing).");
            // Ensure cleanup if stopped unexpectedly
            if (isRunning) stopAutoScrollExport(false);
            return;
        }

        currentIteration++;
        log('debug', `Starting Iteration ${currentIteration}/${CONFIG.maxIterations}`);

        log('log', "Scrolling down...");
        const currentScrollTop = scrollableElement.scrollTop;
        const clientHeight = scrollableElement.clientHeight;
        // Record scroll height *before* this iteration's scroll action
        lastScrollHeight = scrollableElement.scrollHeight;

        scrollableElement.scrollTop += clientHeight * CONFIG.scrollAmountFactor;

        // Short delay for browser rendering after scroll command
        setTimeout(() => {
            log('debug', `Scrolled from ${currentScrollTop} to ${scrollableElement.scrollTop}. Scroll height before this scroll: ${lastScrollHeight}`);
        }, 50);


        // Wait for content to potentially load after scrolling
        scrollTimeoutId = setTimeout(() => {
            if (!isRunning) { log('debug', "Timeout check: isRunning is false. Stopping."); return; }

            let foundNewElements = false;
            let processingErrorOccurred = false;

            // ---- Process Newly Loaded Containers ----
            try {
                log('debug', 'Scanning for job containers...');
                const allJobContainers = document.querySelectorAll(SELECTORS.jobContainer);
                let containersWithoutTop = 0;
                log('debug', `Found ${allJobContainers.length} potential containers in DOM.`);

                allJobContainers.forEach(container => {
                    // Use style.top as the primary identifier. It seems to be unique per item in Midjourney's layout.
                    const containerTop = container.style.top;
                    let containerId = containerTop;

                    if (!containerTop) {
                        // Fallback for containers without style.top (less reliable tracking)
                        containersWithoutTop++;
                        log('warn', "Container without style.top found. Processing with generated ID:", container);
                        // Generate a pseudo-ID; check if *this specific element* was processed (less efficient)
                        // For simplicity here, we'll still use a generated ID, but acknowledge it's less robust.
                        // A better approach might involve WeakSet or element comparison if style.top is unreliable.
                        containerId = `noTop_${Date.now()}_${Math.random()}`;
                        // Process only if this *generated* ID isn't somehow already in the set (unlikely but possible)
                         if (!processedContainerTops.has(containerId)) {
                            processContainer(container, containerId);
                            foundNewElements = true; // Assume it's new if no reliable ID
                         }
                    } else if (!processedContainerTops.has(containerTop)) {
                        // Unique style.top found and not yet processed
                        processContainer(container, containerTop);
                        foundNewElements = true;
                    } else {
                         // Already processed based on style.top
                         log('debug', `Container with top=${containerTop} already processed.`);
                    }
                });
                if (containersWithoutTop > 0) log('warn', `${containersWithoutTop} containers found without style.top this cycle.`);
                log('debug', `Processing scan complete. Found new elements this cycle: ${foundNewElements}`);

            } catch (error) {
                log('error', "!!! Error during container processing:", error);
                processingErrorOccurred = true;
            }

            // ---- Check Stop Conditions ----
            const currentScrollHeight = scrollableElement.scrollHeight;
            // Check if scroll height *remained the same* compared to before we scrolled in *this* iteration
            const scrollHeightUnchanged = currentScrollHeight === lastScrollHeight;
            const isNearScrollEnd = (scrollableElement.scrollTop + scrollableElement.clientHeight >= currentScrollHeight - 20); // Check if near the bottom

            log('debug', `Stop Check: Iter=${currentIteration}/${CONFIG.maxIterations}, FoundNew=${foundNewElements}, ScrollUnchanged=${scrollHeightUnchanged}, Consecutive=${consecutiveNoNewElements}, isNearEnd=${isNearScrollEnd}, Error=${processingErrorOccurred}`);

            let stopReason = null;
            if (processingErrorOccurred) {
                stopReason = "Processing error occurred.";
            } else if (currentIteration >= CONFIG.maxIterations) {
                stopReason = `Maximum iterations (${CONFIG.maxIterations}) reached.`;
            } else {
                if (foundNewElements) {
                    consecutiveNoNewElements = 0; // Reset counter if new things were found
                } else {
                    consecutiveNoNewElements++;
                    // Primary stop: Nothing new AND scroll height hasn't changed for a while
                    if (scrollHeightUnchanged && consecutiveNoNewElements >= CONFIG.maxChecksWithoutNew) {
                         stopReason = `No new elements found and scroll height unchanged for ${CONFIG.maxChecksWithoutNew} checks.`;
                    }
                    // Secondary stop: Near the end AND nothing new for a shorter while
                    else if (isNearScrollEnd && consecutiveNoNewElements >= CONFIG.maxChecksNearScrollEnd) {
                         stopReason = `Near scroll end and no new elements found for ${CONFIG.maxChecksNearScrollEnd} checks.`;
                    }
                }
            }

            // ---- Plan Next Step or Stop ----
            if (stopReason) {
                log('log', `Stop condition met: ${stopReason}. Stopping auto-scroll and generating CSV.`);
                stopAutoScrollExport(true); // Stop and trigger CSV generation
            } else {
                // Continue the loop
                if (isRunning) {
                    // Schedule the next iteration after a short pause
                    loopTimeoutId = setTimeout(scrollAndProcessLoop, CONFIG.loopIntervalMs);
                } else {
                     log('debug', "Loop check at end: isRunning is false, not scheduling next iteration.");
                }
            }

        }, CONFIG.waitAfterScrollMs); // Wait after scrolling for content load
    }


    // ---- Control Functions ----

    /**
     * Starts the auto-scrolling and data extraction process.
     */
    function startAutoScrollExport() {
        if (isRunning) {
            log('warn', "Already running.");
            return;
        }

        // Find the scrollable element
        scrollableElement = document.querySelector(CONFIG.scrollElementSelector);
        if (!scrollableElement || typeof scrollableElement.scrollHeight === 'undefined') {
            alert(`Error: The scrollable element with selector "${CONFIG.scrollElementSelector}" was not found or is not scrollable. Script cannot start.`);
            log('error', `Failed to find a valid scrollable element with selector: ${CONFIG.scrollElementSelector}`);
            return;
        }
        log('debug', `Using scrollable element found with selector "${CONFIG.scrollElementSelector}":`, scrollableElement);

        log('log', `Starting auto-scroll process. Wait after scroll: ${CONFIG.waitAfterScrollMs}ms.`);
        isRunning = true;

        // Reset state variables
        processedContainerTops = new Set();
        allParamNames = new Set();
        intermediateData = [];
        consecutiveNoNewElements = 0;
        currentIteration = 0;
        lastScrollHeight = 0;
        clearTimeout(scrollTimeoutId); // Clear any lingering timeouts
        clearTimeout(loopTimeoutId);
        scrollTimeoutId = null;
        loopTimeoutId = null;


        // Scroll to top before starting
        scrollableElement.scrollTop = 0;
        log('debug', "Scroll position reset to top.");

        // Start the first iteration of the loop after a short delay
        log('debug', "Initial call to scrollAndProcessLoop starting soon...");
        loopTimeoutId = setTimeout(scrollAndProcessLoop, 500); // Start first loop run
    }

    /**
     * Stops the auto-scrolling process.
     * @param {boolean} [generateCsv=false] - If true, automatically triggers CSV generation after stopping.
     */
    function stopAutoScrollExport(generateCsv = false) {
        log('debug', `stopAutoScrollExport() called with generateCsv=${generateCsv}. Current running state: ${isRunning}`);

        if (!isRunning && !scrollTimeoutId && !loopTimeoutId) {
            log('log', "Process already stopped.");
            // If stopped but CSV generation requested again, and data exists
            if (generateCsv && intermediateData.length > 0) {
                 log('log', "Triggering CSV generation manually after already being stopped...");
                 // Use setTimeout to avoid potential race conditions if called rapidly
                 setTimeout(generateFinalCsv, 100);
            }
            return;
        }

        isRunning = false; // Set flag immediately to prevent loops from continuing

        // Clear any scheduled timeouts
        if (scrollTimeoutId) {
            clearTimeout(scrollTimeoutId);
            scrollTimeoutId = null;
            log('debug', 'Cleared scrollTimeoutId.');
        }
         if (loopTimeoutId) {
            clearTimeout(loopTimeoutId);
            loopTimeoutId = null;
            log('debug', 'Cleared loopTimeoutId.');
        }

        log('log', "Auto-scroll process stopped.");

        if (generateCsv) {
            log('log', "Triggering final CSV generation...");
            // Use setTimeout to ensure the stop flag is fully processed before generation
            setTimeout(generateFinalCsv, 200);
        } else {
            log('log', `Collected ${intermediateData.length} entries. Run midjourneyExporter.generate() manually to export.`);
        }
    }

    // ---- Public Interface ----

    // Expose control functions to the global scope for console access
    window.midjourneyExporter = {
        start: startAutoScrollExport,
        stop: () => stopAutoScrollExport(true), // Default stop action generates CSV
        stopWithoutCsv: () => stopAutoScrollExport(false), // Option to stop without generating CSV
        generate: generateFinalCsv, // Allow manual generation if stopped without CSV
        toggleDebug: () => { // Utility to toggle debug logs
             CONFIG.debugLog = !CONFIG.debugLog;
             log('log', `Debug logging ${CONFIG.debugLog ? 'enabled' : 'disabled'}.`);
        }
    };

     // ---- Initial Log Messages ----
     log('log', "Auto-Scrolling Exporter script loaded.");
     log('log', "--------------------------------------------------");
     log('log', "Usage:");
     log('log', "- Ensure you are on your Midjourney gallery/archive page.");
     log('log', "- Run 'midjourneyExporter.start()' in the console to begin.");
     log('log', "- Run 'midjourneyExporter.stop()' to stop early (will generate CSV).");
	   log('log', "- Run 'midjourneyExporter.generate()' to generate CSV if stopped manually.");
		 log('log', "- Run 'midjourneyExporter.generate()' to generate CSV if you used 'stopWithoutCsv()'.");
     log('log', "- Run 'midjourneyExporter.toggleDebug()' to see more detailed logs.");
     log('log', "--------------------------------------------------");

})(); // End of IIFE