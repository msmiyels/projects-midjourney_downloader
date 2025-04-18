/*
     Auto-Scrolling Midjourney Exporter (Enhanced with 'action' column)

     Purpose: Automatically scrolls down the Midjourney page (targeting #pageScroll),
              scrapes job data (prompt, action, parameters, image URL) as it loads,
              and downloads it as a CSV file upon completion or manual stop.
     Usage:   1. Navigate to your Midjourney job history page (e.g., Archive).
              2. Paste this entire script into the browser's developer console (F12).
              3. Run `midjourneyExporter.start()` in the console to begin scrolling and scraping.
              4. Run `midjourneyExporter.stop()` to halt the process manually (CSV will be generated).
              5. Optionally, run `midjourneyExporter.generate()` after stopping if needed.
     Notes:   - DOM selectors may need updates if Midjourney changes its website structure.
              - Relies on finding a scrollable element with ID #pageScroll.
              - Has safety limits for iterations and checks to prevent infinite loops.
              - Includes a fixed 'action' column after 'prompt'.
 */

(function() {
    'use strict';

    // ---- Configuration ----

    const CONFIG = {
        scrollElementSelector: "#pageScroll",
        waitAfterScrollMs: 1500,
        scrollAmountFactor: 0.8,
        maxChecksWithoutNew: 10,
        maxChecksNearScrollEnd: 5,
        maxIterations: 5000,
        loopIntervalMs: 100,
        csvFilenamePrefix: 'midjourney_auto_action_export_', // Updated prefix
        logPrefix: '[Exporter Auto Action]', // Updated prefix
        debugLog: false
    };

    const SELECTORS = {
        jobContainer: 'div.absolute.flex-col.grid[class*="grid-cols"]',
        promptWrapper: 'div.relative.group\\/promptText',
        promptSpan: 'span.relative',
        promptFallback: 'div.overflow-clip.flex.relative span.relative',
        // MODIFICATION: Added selector for the action keyword span
        actionSpan: '.text-splash\\/90', // Span possibly containing action keywords like "Upscale"
        paramsContainer: 'div.flex.flex-wrap.gap-1.empty\\:hidden',
        paramButton: 'button',
        paramNameSpan: 'span.opacity-80 > span.opacity-80',
        paramValueSibling: 'span:not(.opacity-80)',
        imageGrid: 'div.grid.gap-\\[1px\\], div.grid.lg\\:gap-2',
        imageLink: 'div.relative.group > a',
        imageElement: 'img[src*="cdn.midjourney.com/"]',
    };

    const DEFAULT_VALUES = {
        prompt: 'PROMPT_NOT_FOUND',
        jobId: 'ID_NOT_FOUND',
        pngSrc: 'NO_IMAGE_SRC',
        // MODIFICATION: Added default for action field (though null is used internally)
        action: '',
    };


    // ---- State Variables ----

    let scrollTimeoutId = null;
    let loopTimeoutId = null;
    let processedContainerTops = new Set();
    let allParamNames = new Set();
    // MODIFICATION: intermediateData now stores {jobId, pngSrc, prompt, action, jobParams}
    let intermediateData = [];
    let consecutiveNoNewElements = 0;
    let currentIteration = 0;
    let isRunning = false;
    let scrollableElement = null;
    let lastScrollHeight = 0;


    // ---- Helper Functions ----

    /* Log messages */
    function log(level, ...args) {
        const prefix = CONFIG.logPrefix;
        if (level === 'debug' && !CONFIG.debugLog) {
            return;
        }
        console[level](prefix, ...args);
    }

    /* Download CSV */
    function downloadCSV(csvContent, filename) {
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

    /* Escape CSV Field */
    function escapeCsvField(field) {
        if (field === null || field === undefined) {
            return '""'; // Return empty quoted string for null/undefined
        }
        const stringField = String(field);
        // Only quote if necessary
        if (stringField.includes(',') || stringField.includes('\n') || stringField.includes('"')) {
             return `"${stringField.replace(/"/g, '""')}"`;
        }
        return stringField;
    }


    // ---- Data Extraction (Processing a Single Container) ----

    /*
        Extracts data (including action keyword) from a single job container and updates shared state.
        @param {Element} jobContainer - The DOM element of the job container.
        @param {string} containerId - A unique identifier for this container.
    */
    function processContainer(jobContainer, containerId) {
        log('debug', `Processing NEW container with ID: ${containerId}`);
        processedContainerTops.add(containerId);

        // --- Extract Prompt and Action Keyword ---
        const promptWrapper = jobContainer.querySelector(SELECTORS.promptWrapper);
        let rawPromptText = DEFAULT_VALUES.prompt;
        let promptElementSource = null; // Track where the prompt text came from

        if (promptWrapper) {
            // Prefer the inner '.break-word' div for full text content
            let promptContentElement = promptWrapper.querySelector('.break-word');
            if (promptContentElement) {
                rawPromptText = promptContentElement.textContent?.trim() ?? rawPromptText;
                promptElementSource = promptWrapper; // Mark as found in primary wrapper
            } else {
                // Fallback to span within wrapper if '.break-word' not found
                promptContentElement = promptWrapper.querySelector(SELECTORS.promptSpan);
                 if (promptContentElement) {
                     rawPromptText = promptContentElement.textContent?.trim() ?? rawPromptText;
                     promptElementSource = promptWrapper;
                 }
            }
        }
        // Use fallback selector only if nothing was found via promptWrapper
        if (rawPromptText === DEFAULT_VALUES.prompt) {
            let fallbackElement = jobContainer.querySelector(SELECTORS.promptFallback);
             if (fallbackElement) {
                  rawPromptText = fallbackElement.textContent?.trim() ?? rawPromptText;
                  promptElementSource = fallbackElement; // Source is fallback
             }
        }

        // MODIFICATION: Separate action keyword from prompt text
        let actionKeyword = null; // Holds the keyword string ("Upscale", etc.) or null
        let cleanedPrompt = rawPromptText; // Start with the full text

        // Only search for action keyword if text came from the primary wrapper and is not the default value
        if (promptElementSource === promptWrapper && rawPromptText !== DEFAULT_VALUES.prompt) {
            const actionSpan = promptWrapper.querySelector(SELECTORS.actionSpan);
            if (actionSpan) {
                const foundKeyword = actionSpan.textContent?.trim();
                // Verify the raw text starts with the found keyword
                if (foundKeyword && rawPromptText.startsWith(foundKeyword)) {
                    actionKeyword = foundKeyword; // Store the keyword
                    cleanedPrompt = rawPromptText.substring(actionKeyword.length).trim(); // Get the rest as prompt
                    log('debug', `Found action '${actionKeyword}', cleaned prompt for container ${containerId}`);
                } else {
                     log('debug', `Action span found but text did not start with '${foundKeyword}' for container ${containerId}`);
                }
            }
        }
        // --- End Prompt/Action Extraction ---


        // --- Extract Parameters (Original Logic) ---
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
                if (!paramValue) paramValue = "true"; // Handle flag parameters
                allParamNames.add(paramName); // Collect unique parameter names
                jobParams[paramName] = paramValue;
            });
        }
        // --- End Parameters ---


        // --- Extract Images and Store Data ---
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

                // MODIFICATION: Store data including the new 'action' field
                intermediateData.push({
                    jobId,
                    pngSrc,
                    prompt: cleanedPrompt,  // Use the cleaned prompt text
                    action: actionKeyword,  // Store the found action keyword (or null)
                    jobParams             // Store the parameters object
                });
                processedImage = true;
                log('debug', `Stored entry for jobId ${jobId} with action: ${actionKeyword}`);
            });
        }

        // Handle cases with data but no image found
        // Store if we found a non-default prompt OR any parameters OR an action keyword
        if (!processedImage && (cleanedPrompt !== DEFAULT_VALUES.prompt || Object.keys(jobParams).length > 0 || actionKeyword !== null)) {
            log('warn', `Container with data but no image found (ID: ${containerId}). Storing entry.`);
            // MODIFICATION: Ensure 'action' field is included here too
            intermediateData.push({
                jobId: DEFAULT_VALUES.jobId,
                pngSrc: DEFAULT_VALUES.pngSrc,
                prompt: cleanedPrompt,
                action: actionKeyword, // Store action keyword here as well
                jobParams
            });
        }
        // --- End Image/Storage ---
    } // End processContainer


    // ---- CSV Generation ----

    /*
        Generates the final CSV content from intermediateData and initiates download.
    */
    function generateFinalCsv() {
        log('debug', 'generateFinalCsv() called.');
        log('debug', `Generating CSV from ${intermediateData.length} entries.`);

        if (intermediateData.length === 0) {
            alert('No data collected to export.');
            log('error', "No data collected. Cannot generate CSV.");
            return;
        }

        const sortedParamNames = Array.from(allParamNames).sort();
        // MODIFICATION: Define header with 'action' column placed right after 'prompt'
        const header = ['job_id', 'url', 'prompt', 'action', ...sortedParamNames];
        const csvRows = [];

        log('debug', `Final CSV Header: ${header.join(', ')}`);
        csvRows.push(header.map(escapeCsvField).join(',')); // Add escaped header row

        intermediateData.forEach(entry => {
            // MODIFICATION: Build the row array matching the new header order
            const rowData = [
                escapeCsvField(entry.jobId),
                escapeCsvField(entry.pngSrc),
                escapeCsvField(entry.prompt),    // Escaped cleaned prompt
                escapeCsvField(entry.action),    // Escaped action keyword (or null -> "")
            ];
            const paramValues = sortedParamNames.map(colName => {
                const value = entry.jobParams[colName];
                return escapeCsvField(value ?? ''); // Escape parameter value or "" if missing
            });
            // Combine the initial fields (incl. action) with parameter values
            csvRows.push([...rowData, ...paramValues].join(','));
        });

        log('debug', `Generated ${csvRows.length} CSV rows (including header).`);

        if (csvRows.length > 1) {
            const finalCSV = csvRows.join('\n');
            const filename = `${CONFIG.csvFilenamePrefix}${new Date().toISOString().slice(0, 10)}.csv`;
            log('debug', `Attempting to download CSV with ${csvRows.length - 1} data rows.`);
            downloadCSV(finalCSV, filename);
            log('log', `Exported ${intermediateData.length} data entries.`);
        } else {
            alert('Error creating CSV data or no data available after header.');
            log('error', "Error during final CSV generation or no data rows found.");
        }
    } // End generateFinalCsv


    // ---- Auto-Scrolling Core Loop ----

    /*
        The main loop that scrolls, waits, processes, and checks stop conditions.
        (No changes needed in the loop logic itself, only in processContainer called by it)
    */
    function scrollAndProcessLoop() {
        if (!isRunning || !scrollableElement) {
            log('debug', "Loop check: Stopping (isRunning false or scrollableElement missing).");
            if (isRunning) stopAutoScrollExport(false); // Cleanup if stopped unexpectedly
            return;
        }

        currentIteration++;
        log('debug', `Starting Iteration ${currentIteration}/${CONFIG.maxIterations}`);
        log('log', "Scrolling down...");
        const currentScrollTop = scrollableElement.scrollTop;
        const clientHeight = scrollableElement.clientHeight;
        lastScrollHeight = scrollableElement.scrollHeight; // Record height *before* scroll

        scrollableElement.scrollTop += clientHeight * CONFIG.scrollAmountFactor;

        setTimeout(() => { /* Optional: Log scroll position change */ }, 50);

        // Wait for content load
        scrollTimeoutId = setTimeout(() => {
            if (!isRunning) { log('debug', "Timeout check: isRunning is false. Stopping."); return; }

            let foundNewElements = false;
            let processingErrorOccurred = false;

            // Process Newly Loaded Containers
            try {
                log('debug', 'Scanning for job containers...');
                const allJobContainers = document.querySelectorAll(SELECTORS.jobContainer);
                let containersWithoutTop = 0;
                log('debug', `Found ${allJobContainers.length} potential containers in DOM.`);

                allJobContainers.forEach(container => {
                    // Using style.top as primary ID
                    const containerTop = container.style.top;
                    let containerId = containerTop || `noTop_${Date.now()}_${Math.random()}`; // Generate ID if no style.top

                    if (!processedContainerTops.has(containerId)) {
                         if (!containerTop) {
                             containersWithoutTop++;
                             log('warn', "Container without style.top found. Processing with generated ID:", container);
                         }
                        processContainer(container, containerId); // Calls the modified function
                        foundNewElements = true;
                    } else {
                         log('debug', `Container ID ${containerId} already processed.`);
                    }
                });
                if (containersWithoutTop > 0) log('warn', `${containersWithoutTop} containers found without style.top this cycle.`);
                log('debug', `Processing scan complete. Found new: ${foundNewElements}`);

            } catch (error) {
                log('error', "!!! Error during container processing:", error);
                processingErrorOccurred = true;
            }

            // ---- Check Stop Conditions ----
            const currentScrollHeight = scrollableElement.scrollHeight;
            const scrollHeightUnchanged = currentScrollHeight === lastScrollHeight;
            const isNearScrollEnd = (scrollableElement.scrollTop + scrollableElement.clientHeight >= currentScrollHeight - 20);

            log('debug', `Stop Check: Iter=${currentIteration}/${CONFIG.maxIterations}, FoundNew=${foundNewElements}, ScrollUnchanged=${scrollHeightUnchanged}, Consecutive=${consecutiveNoNewElements}, isNearEnd=${isNearScrollEnd}, Error=${processingErrorOccurred}`);

            let stopReason = null;
            if (processingErrorOccurred) { stopReason = "Processing error."; }
            else if (currentIteration >= CONFIG.maxIterations) { stopReason = `Max iterations (${CONFIG.maxIterations}) reached.`; }
            else {
                if (foundNewElements) { consecutiveNoNewElements = 0; }
                else {
                    consecutiveNoNewElements++;
                    if (scrollHeightUnchanged && consecutiveNoNewElements >= CONFIG.maxChecksWithoutNew) { stopReason = `No new elements & scroll height unchanged for ${CONFIG.maxChecksWithoutNew} checks.`; }
                    else if (isNearScrollEnd && consecutiveNoNewElements >= CONFIG.maxChecksNearScrollEnd) { stopReason = `Near scroll end & no new elements for ${CONFIG.maxChecksNearScrollEnd} checks.`; }
                }
            }

            // ---- Plan Next Step or Stop ----
            if (stopReason) {
                log('log', `Stop condition met: ${stopReason}. Stopping & generating CSV.`);
                stopAutoScrollExport(true); // Stop and generate CSV
            } else {
                if (isRunning) { loopTimeoutId = setTimeout(scrollAndProcessLoop, CONFIG.loopIntervalMs); } // Schedule next loop
                else { log('debug', "Loop check at end: isRunning is false, not scheduling next iteration."); }
            }

        }, CONFIG.waitAfterScrollMs);
    } // End scrollAndProcessLoop


    // ---- Control Functions ----

    /* Starts the process */
    function startAutoScrollExport() {
        if (isRunning) { log('warn', "Already running."); return; }

        scrollableElement = document.querySelector(CONFIG.scrollElementSelector);
        if (!scrollableElement || typeof scrollableElement.scrollHeight === 'undefined') {
            alert(`Error: Scroll element "${CONFIG.scrollElementSelector}" not found or not scrollable.`);
            log('error', `Failed to find valid scroll element: ${CONFIG.scrollElementSelector}`);
            return;
        }
        log('debug', `Using scroll element:`, scrollableElement);
        log('log', `Starting auto-scroll. Wait after scroll: ${CONFIG.waitAfterScrollMs}ms.`);
        isRunning = true;

        // Reset state
        processedContainerTops = new Set();
        allParamNames = new Set();
        intermediateData = [];
        consecutiveNoNewElements = 0;
        currentIteration = 0;
        lastScrollHeight = 0;
        clearTimeout(scrollTimeoutId); scrollTimeoutId = null;
        clearTimeout(loopTimeoutId); loopTimeoutId = null;

        scrollableElement.scrollTop = 0; // Scroll to top
        log('debug', "Scroll position reset.");

        // Start the loop
        log('debug', "Initial call to scrollAndProcessLoop scheduled.");
        loopTimeoutId = setTimeout(scrollAndProcessLoop, 500);
    }

    /* Stops the process */
    function stopAutoScrollExport(generateCsv = false) {
        log('debug', `stopAutoScrollExport called (generateCsv=${generateCsv}). Running: ${isRunning}`);
        if (!isRunning && !scrollTimeoutId && !loopTimeoutId) {
            log('log', "Process already stopped.");
            if (generateCsv && intermediateData.length > 0) {
                 log('log', "Triggering CSV generation manually after being stopped...");
                 setTimeout(generateFinalCsv, 100); // Allow manual generation
            }
            return;
        }
        isRunning = false; // Set flag FIRST

        if (scrollTimeoutId) { clearTimeout(scrollTimeoutId); scrollTimeoutId = null; log('debug', 'Cleared scrollTimeoutId.'); }
        if (loopTimeoutId) { clearTimeout(loopTimeoutId); loopTimeoutId = null; log('debug', 'Cleared loopTimeoutId.'); }
        log('log', "Auto-scroll process stopped.");

        if (generateCsv) {
            log('log', "Triggering final CSV generation...");
            setTimeout(generateFinalCsv, 200); // Generate after a short delay
        } else {
            log('log', `Collected ${intermediateData.length} entries. Run midjourneyExporter.generate() manually.`);
        }
    }


    // ---- Public Interface ----

    window.midjourneyExporter = {
        start: startAutoScrollExport,
        stop: () => stopAutoScrollExport(true), // Default stop generates CSV
        stopWithoutCsv: () => stopAutoScrollExport(false), // Option to stop without CSV
        generate: generateFinalCsv, // Manual CSV generation
        toggleDebug: () => {
             CONFIG.debugLog = !CONFIG.debugLog;
             log('log', `Debug logging ${CONFIG.debugLog ? 'enabled' : 'disabled'}.`);
        }
    };

     // ---- Initial Log Messages ----
     log('log', "Auto-Scrolling Exporter (with Action column) script loaded.");
     log('log', "--------------------------------------------------");
     log('log', "Usage:");
     log('log', "- Navigate to your Midjourney gallery/archive.");
     log('log', "- Run 'midjourneyExporter.start()' in console.");
     log('log', "- Run 'midjourneyExporter.stop()' to halt (generates CSV).");
     log('log', "- Run 'midjourneyExporter.generate()' to export if stopped without CSV.");
     log('log', "- Run 'midjourneyExporter.toggleDebug()' for verbose logs.");
     log('log', "--------------------------------------------------");

})(); // End of IIFE