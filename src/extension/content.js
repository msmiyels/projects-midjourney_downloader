// content.js - Injected into Midjourney pages to perform scrolling and scraping.
// Adapted from the user-provided midjourney_auto_mode.js
// v7: Reverted to v2 logic (return true, sync sendResponse), removed custom log function.

(function () {
    // Log prefix for easier debugging in the page's console
    const LOG_PREFIX = '[MJ Scraper Content]';
    console.log(`${LOG_PREFIX} Script loaded and running (v7).`);

    // --- Configuration ---
    const CONFIG = {
        scrollElementSelector: "#pageScroll",
        waitAfterScrollMs: 350,
        scrollAmountFactor: 0.8,
        maxChecksWithoutNew: 15,
        maxChecksNearScrollEnd: 8,
        maxIterations: 5000,
        loopIntervalMs: 150,
        dataChunkSize: 50,
        // debugLog: true // Debug logs removed
    };

    // --- DOM Selectors ---
    // IMPORTANT: Verify these selectors against the current Midjourney website structure.
    const SELECTORS = {
        jobContainer: 'div.absolute.flex-col.grid[class*="grid-cols"]',
        promptWrapper: 'div.relative.group\\/promptText',
        promptSpan: 'span.relative',
        promptFallback: 'div.overflow-clip.flex.relative span.relative',
        actionSpan: '.text-splash\\/90', // Verify this class for actions like "Upscale"
        paramsContainer: 'div.flex.flex-wrap.gap-1.empty\\:hidden',
        paramButton: 'button',
        paramNameSpan: 'span.opacity-80 > span.opacity-80', // Verify!
        paramValueSibling: 'span:not(.opacity-80)', // Verify!
        imageGrid: 'div.grid.gap-\\[1px\\], div.grid.lg\\:gap-2',
        imageLink: 'div.relative.group > a',
        imageElement: 'img[src*="cdn.midjourney.com/"]',
    };

    // --- Default Values ---
    const DEFAULT_VALUES = {
        prompt: 'PROMPT_NOT_FOUND',
        jobId: 'ID_NOT_FOUND',
        pngSrc: 'NO_IMAGE_SRC',
        originalUrl: 'NO_ORIGINAL_URL',
        action: '',
    };

    // --- State Variables ---
    let scrollTimeoutId = null;
    let loopTimeoutId = null;
    let processedContainerTops = new Set();
    let intermediateData = []; // Buffer holds {job_id, url (png), original_url (webp), prompt, action, jobParams}
    let allParamNames = new Set();
    let consecutiveNoNewElements = 0;
    let currentIteration = 0;
    let isRunning = false;
    let scrollableElement = null;
    let lastScrollHeight = 0;

    // --- Helper Functions ---

    /* Removed custom log function - using console directly */

    /**
     * Sends a status update message to the background script with the current scraping status, item count, and running state.
     *
     * @param {string} statusMessage - The status message to report.
     * @param {number|null} [count=null] - Optional count of items; defaults to the current buffer length if not provided.
     * @param {boolean} [running=isRunning] - Optional running state; defaults to the current running state.
     *
     * @remark
     * Common connection errors are silently ignored if the background script or popup is not ready.
     */
    function sendStatusUpdate(statusMessage, count = null, running = isRunning) {
        // console.log(`${LOG_PREFIX} Sending status update: ${statusMessage}, Count: ${count}, Running: ${running}`); // Basic logging
        try {
            chrome.runtime.sendMessage({
                action: "content-status-update",
                status: statusMessage,
                count: count !== null ? count : intermediateData.length,
                isRunning: running
            }).catch(error => {
                // Avoid logging common errors when popup/background isn't ready
                const msg = error.message || '';
                // **MODIFICATION:** Check specifically for the error we are trying to ignore.
                if (!msg.includes("Could not establish connection") && !msg.includes("Receiving end does not exist") && !msg.includes("message channel closed before a response was received")) {
                    console.error(`${LOG_PREFIX} Error sending status update:`, error);
                } else {
                    // console.log(`${LOG_PREFIX} Ignored expected error sending status update: ${msg}`); // Optional: log ignored errors
                }
            });
        } catch (error) {
            console.error(`${LOG_PREFIX} Synchronous error during sendStatusUpdate:`, error);
        }
    }

    /**
     * Sends the buffered scraped data and collected parameter names to the background script.
     *
     * Only clears the data buffer after receiving confirmation of successful receipt from the background script.
     * Logs a warning if the background script does not acknowledge receipt.
     */
    function sendDataChunk() {
        if (intermediateData.length === 0) {
            return; // Nothing to send
        }

        console.log(`${LOG_PREFIX} Preparing to send ${intermediateData.length} data items to background.`);
        const dataToSend = [...intermediateData];

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                action: "scraped-data",
                data: dataToSend,
                params: Array.from(allParamNames)
            })
                .then(response => {
                    if (response && response.received) {
                        // Only clear the buffer after successful transmission
                        intermediateData = [];
                        // console.log(`${LOG_PREFIX} Background script acknowledged data receipt.`);
                        resolve(true);
                    } else {
                        console.warn(`${LOG_PREFIX} Background script did not acknowledge data receipt properly. Data preserved for retry.`);
                        resolve(false);
                    }
                })
                .catch(error => {
                    console.error(`${LOG_PREFIX} Error sending data chunk:`, error);
                    console.warn(`${LOG_PREFIX} Data preserved for retry after error.`);
                    resolve(false);
                });
        });
    }

    // --- Data Extraction ---

    /**
     * Extracts prompt text, action keyword, parameters, and image URLs from a job container element and buffers the data for later transmission.
     *
     * For each image found, stores an entry with the job ID, PNG URL, original WEBP URL, prompt, action, and parameters. If no images are present but other data exists, stores an entry with default image URLs.
     *
     * @param {HTMLElement} jobContainer - The DOM element representing a single job container.
     * @param {string} containerId - A unique identifier for the job container.
     */
    function processContainer(jobContainer, containerId) {
        try {
            // console.log(`${LOG_PREFIX} Processing NEW container with ID: ${containerId}`); // Basic logging
            processedContainerTops.add(containerId);

            // --- Extract Prompt and Action Keyword (Verify Selectors!) ---
            const promptWrapper = jobContainer.querySelector(SELECTORS.promptWrapper);
            let rawPromptText = DEFAULT_VALUES.prompt;
            let promptElementSource = null;

            if (promptWrapper) {
                let promptContentElement = promptWrapper.querySelector('.break-word');
                if (promptContentElement) {
                    rawPromptText = promptContentElement.textContent?.trim() ?? rawPromptText;
                    promptElementSource = promptWrapper;
                } else {
                    promptContentElement = promptWrapper.querySelector(SELECTORS.promptSpan);
                    if (promptContentElement) {
                        rawPromptText = promptContentElement.textContent?.trim() ?? rawPromptText;
                        promptElementSource = promptWrapper;
                    }
                }
            }
            if (rawPromptText === DEFAULT_VALUES.prompt) {
                let fallbackElement = jobContainer.querySelector(SELECTORS.promptFallback);
                if (fallbackElement) {
                    rawPromptText = fallbackElement.textContent?.trim() ?? rawPromptText;
                    promptElementSource = fallbackElement;
                }
            }

            let actionKeyword = null;
            let cleanedPrompt = rawPromptText;

            if (promptElementSource === promptWrapper && rawPromptText !== DEFAULT_VALUES.prompt) {
                const actionSpan = promptWrapper.querySelector(SELECTORS.actionSpan);
                if (actionSpan) {
                    const foundKeyword = actionSpan.textContent?.trim();
                    if (foundKeyword && rawPromptText.startsWith(foundKeyword)) {
                        actionKeyword = foundKeyword;
                        cleanedPrompt = rawPromptText.substring(actionKeyword.length).trim();
                        // console.log(`${LOG_PREFIX} Found action '${actionKeyword}' for container ${containerId}`); // Basic logging
                    }
                }
            }
            // --- End Prompt/Action Extraction ---

            // --- Extract Parameters (Verify Selectors!) ---
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
                    if (!paramValue) paramValue = "true";
                    allParamNames.add(paramName);
                    jobParams[paramName] = paramValue;
                });
            }
            // --- End Parameters ---

            // --- Extract Images and Store Data (Verify Selectors!) ---
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

                    const originalUrl = src.split('?')[0] ?? DEFAULT_VALUES.originalUrl;
                    const pngUrl = originalUrl.replace(/\.webp$/i, '.png');

                    intermediateData.push({
                        job_id: jobId,
                        url: pngUrl,
                        original_url: originalUrl,
                        prompt: cleanedPrompt,
                        action: actionKeyword ?? DEFAULT_VALUES.action,
                        jobParams
                    });
                    processedImage = true;
                    // console.log(`${LOG_PREFIX} Stored entry for jobId ${jobId}. PNG URL: ${pngUrl}, Original: ${originalUrl}`); // Basic logging
                });
            }

            // Handle cases with data but no image found
            if (!processedImage && (cleanedPrompt !== DEFAULT_VALUES.prompt || Object.keys(jobParams).length > 0 || actionKeyword !== null)) {
                console.warn(`${LOG_PREFIX} Container with data but no image found (ID: ${containerId}). Storing entry with default URLs.`);
                intermediateData.push({
                    job_id: DEFAULT_VALUES.jobId,
                    url: DEFAULT_VALUES.pngSrc,
                    original_url: DEFAULT_VALUES.originalUrl,
                    prompt: cleanedPrompt,
                    action: actionKeyword ?? DEFAULT_VALUES.action,
                    jobParams
                });
            }
            // --- End Image/Storage ---
        } catch (error) {
            console.error(`${LOG_PREFIX} Error processing container ${containerId}:`, error);
        }
    } // End processContainer


    /**
     * Performs the main auto-scrolling and scraping loop, processing new job containers and sending data chunks until stop conditions are met.
     *
     * The loop scrolls the target element, waits, scans for new job containers, processes unprocessed containers, and buffers extracted data. It checks for stop conditions such as reaching the maximum number of iterations, encountering processing errors, finding no new elements after several checks, or reaching the scroll end with no new data. When a stop condition is met, the scraping process is halted and any remaining data is sent.
     */
    function scrollAndProcessLoop() {
        if (!isRunning || !scrollableElement) {
            // console.log(`${LOG_PREFIX} Loop check: Stopping (isRunning false or scrollableElement missing).`); // Basic logging
            if (isRunning) stopScraping(false);
            return;
        }

        currentIteration++;
        // console.log(`${LOG_PREFIX} Starting Iteration ${currentIteration}/${CONFIG.maxIterations}`); // Basic logging
        if (currentIteration % 10 === 0) {
            sendStatusUpdate(`Running (Iteration ${currentIteration})...`);
        }

        const currentScrollTop = scrollableElement.scrollTop;
        const clientHeight = scrollableElement.clientHeight;
        lastScrollHeight = scrollableElement.scrollHeight;

        scrollableElement.scrollTop += clientHeight * CONFIG.scrollAmountFactor;
        // console.log(`${LOG_PREFIX} Scrolled. New scrollTop: ${scrollableElement.scrollTop}, Last scrollHeight: ${lastScrollHeight}`); // Basic logging

        scrollTimeoutId = setTimeout(() => {
            if (!isRunning) { /* console.log(`${LOG_PREFIX} Timeout check: isRunning is false. Stopping loop.`); */ return; } // Basic logging

            let foundNewElements = false;
            let processingErrorOccurred = false;

            try {
                // console.log(`${LOG_PREFIX} Scanning for job containers...`); // Basic logging
                const allJobContainers = document.querySelectorAll(SELECTORS.jobContainer);
                let containersWithoutTop = 0;
                // console.log(`${LOG_PREFIX} Found ${allJobContainers.length} potential containers in DOM.`); // Basic logging

                allJobContainers.forEach(container => {
                    const containerTop = container.style.top;
                    let containerId = containerTop || `noTop_${Date.now()}_${Math.random()}`;

                    if (!processedContainerTops.has(containerId)) {
                        if (!containerTop) containersWithoutTop++;
                        processContainer(container, containerId);
                        foundNewElements = true;
                    }
                });
                if (containersWithoutTop > 0) console.warn(`${LOG_PREFIX} ${containersWithoutTop} containers found without style.top this cycle.`);
                // console.log(`${LOG_PREFIX} Processing scan complete. Found new elements: ${foundNewElements}`); // Basic logging

                if (intermediateData.length >= CONFIG.dataChunkSize || (foundNewElements && intermediateData.length > 0)) {
                    sendDataChunk().then(success => {
                        if (!success) {
                            console.error(`${LOG_PREFIX} Data chunk not sent successfully. Retrying in next iteration.`);
                        }
                    });
                }

            } catch (error) {
                console.error(`${LOG_PREFIX} !!! Error during container processing loop:`, error);
                processingErrorOccurred = true;
            }

            // ---- Check Stop Conditions ----
            const currentScrollHeight = scrollableElement.scrollHeight;
            const scrollHeightUnchanged = currentScrollHeight === lastScrollHeight;
            const isAtScrollEnd = (scrollableElement.scrollTop + scrollableElement.clientHeight >= currentScrollHeight - 20);

            // console.log(`${LOG_PREFIX} Stop Check: Iter=${currentIteration}, FoundNew=${foundNewElements}, ScrollUnchanged=${scrollHeightUnchanged}, ConsecutiveNoNew=${consecutiveNoNewElements}, isAtEnd=${isAtScrollEnd}, Error=${processingErrorOccurred}`); // Basic logging

            let stopReason = null;

            if (processingErrorOccurred) {
                stopReason = "Processing error encountered.";
            } else if (currentIteration >= CONFIG.maxIterations) {
                stopReason = `Max iterations (${CONFIG.maxIterations}) reached.`;
            } else {
                if (foundNewElements) {
                    consecutiveNoNewElements = 0;
                } else {
                    consecutiveNoNewElements++;
                    if (scrollHeightUnchanged && consecutiveNoNewElements >= CONFIG.maxChecksWithoutNew) {
                        stopReason = `No new elements found for ${CONFIG.maxChecksWithoutNew} checks and scroll height is unchanged.`;
                    } else if (isAtScrollEnd && consecutiveNoNewElements >= CONFIG.maxChecksNearScrollEnd) {
                        stopReason = `Reached scroll end and no new elements found for ${CONFIG.maxChecksNearScrollEnd} checks.`;
                    }
                }
            }

            // ---- Plan Next Step or Stop ----
            if (stopReason) {
                console.log(`${LOG_PREFIX} Stop condition met: ${stopReason}. Stopping scraping.`); // Basic logging
                stopScraping(true);
            } else {
                if (isRunning) {
                    loopTimeoutId = setTimeout(scrollAndProcessLoop, CONFIG.loopIntervalMs);
                } else {
                    // console.log(`${LOG_PREFIX} Loop check at end: isRunning is false, not scheduling next iteration.`); // Basic logging
                }
            }

        }, CONFIG.waitAfterScrollMs);
    } // End scrollAndProcessLoop


    // ---- Control Functions ----

    /**
     * Starts the automated scraping process by initializing state, verifying the scrollable element, and launching the scroll-and-process loop.
     *
     * @returns {{status: string, message?: string} | undefined} An object indicating the start status, or an error message if initialization fails.
     *
     * @remark If the scrollable element cannot be found or is not scrollable, the function alerts the user and returns an error status.
     */
    function startScraping() {
        if (isRunning) {
            console.warn(`${LOG_PREFIX} Start command received, but scraping is already running.`);
            sendStatusUpdate("Already running...");
            return { status: "already_running", message: "Scraping is already in progress." }; // Return status for listener
        }

        scrollableElement = document.querySelector(CONFIG.scrollElementSelector);
        if (!scrollableElement || typeof scrollableElement.scrollHeight === 'undefined') {
            const errorMsg = `Error: Scroll element "${CONFIG.scrollElementSelector}" not found or is not scrollable. Cannot start.`;
            console.error(`${LOG_PREFIX} ${errorMsg}`);
            alert(errorMsg + "\n\nPlease ensure you are on the correct Midjourney page (e.g., Archive, Imagine) and the page structure hasn't changed significantly.");
            sendStatusUpdate("Error: Scroll element not found", null, false);
            return { status: "error", message: errorMsg }; // Return status for listener
        }

        console.log(`${LOG_PREFIX} Starting auto-scroll scraping. Wait after scroll: ${CONFIG.waitAfterScrollMs}ms.`); // Basic logging
        isRunning = true;

        // --- Reset State for a Fresh Run ---
        processedContainerTops = new Set();
        intermediateData = [];
        allParamNames = new Set();
        consecutiveNoNewElements = 0;
        currentIteration = 0;
        lastScrollHeight = 0;
        clearTimeout(scrollTimeoutId); scrollTimeoutId = null;
        clearTimeout(loopTimeoutId); loopTimeoutId = null;

        chrome.runtime.sendMessage({ action: "clear-data" }).catch(e => console.warn(`${LOG_PREFIX} Could not clear background data before start:`, e.message));

        scrollableElement.scrollTop = 0;
        // console.log(`${LOG_PREFIX} Scroll position reset to top.`); // Basic logging
        sendStatusUpdate("Running...");

        // --- Start the Loop ---
        // console.log(`${LOG_PREFIX} Initial call to scrollAndProcessLoop scheduled.`); // Basic logging
        loopTimeoutId = setTimeout(scrollAndProcessLoop, 500);

        return { status: "started" }; // Return status for listener
    }

    /**
     * Stops the scraping process and performs cleanup.
     *
     * If the process is already stopped, sends a status update and returns an appropriate status. Otherwise, clears timeouts, updates the running state, sends any remaining buffered data, and issues a final status update after a short delay.
     *
     * @param {boolean} [finishedNaturally=false] - Indicates whether the process finished naturally or was manually stopped.
     * @returns {{status: string}} An object indicating the stop status for use by listeners and internal logic.
     */
    function stopScraping(finishedNaturally = false) {
        // console.log(`${LOG_PREFIX} stopScraping called (finishedNaturally=${finishedNaturally}). Current isRunning state: ${isRunning}`); // Basic logging

        if (!isRunning && !scrollTimeoutId && !loopTimeoutId) {
            console.log(`${LOG_PREFIX} Stop command received, but process appears already stopped.`); // Basic logging
            sendStatusUpdate(finishedNaturally ? "Finished" : "Stopped", null, false);
            return { status: "already_stopped" }; // Return status for listener
        }

        const wasRunning = isRunning;
        isRunning = false;

        if (scrollTimeoutId) { clearTimeout(scrollTimeoutId); scrollTimeoutId = null; /* console.log(`${LOG_PREFIX} Cleared scrollTimeoutId.`); */ } // Basic logging
        if (loopTimeoutId) { clearTimeout(loopTimeoutId); loopTimeoutId = null; /* console.log(`${LOG_PREFIX} Cleared loopTimeoutId.`); */ } // Basic logging

        console.log(`${LOG_PREFIX} Auto-scroll process has been stopped.`); // Basic logging

        if (wasRunning && intermediateData.length > 0) {
            console.log(`${LOG_PREFIX} Sending final data chunk after stop...`); // Basic logging
            sendDataChunk();
        }

        // Send final status update after a delay
        setTimeout(() => {
            const finalStatus = finishedNaturally ? "Finished" : "Stopped";
            sendStatusUpdate(finalStatus, null, false);
        }, 200);

        return { status: "stopped" }; // Return status for listener
    }


    // ---- Message Listener (from Popup/Background) ----
    /**
     * Listens for messages from other parts of the extension.
     * Handles 'start-scraping' and 'stop-scraping' commands.
     * Reverted to using 'return true' and sending synchronous response.
     */
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log(`${LOG_PREFIX} Content script received message:`, message); // Basic logging
        try {
            switch (message.action) {
                case "start-scraping": {
                    // Call start function and send its response back
                    const startResponse = startScraping();
                    sendResponse(startResponse);
                    break; // Exit switch
                }

                case "stop-scraping": {
                    // Call stop function and send its response back
                    const stopResponse = stopScraping(false);
                    sendResponse(stopResponse);
                    break; // Exit switch
                }

                default: {
                    console.warn(`${LOG_PREFIX} Unknown message action received:`, message.action);
                    // No response needed for unknown actions
                    break; // Exit switch
                }
            }
        } catch (error) {
            console.error(`${LOG_PREFIX} Error processing message action '${message?.action}':`, error);
            // Attempt to send an error response if possible
            try {
                sendResponse({ status: "error", message: "Internal content script error processing message." });
            } catch (e) {
                console.error(`${LOG_PREFIX} Failed to send error response:`, e);
            }
        }

        // Return true to indicate that the response MAY be sent asynchronously
        // (or synchronously as we do here). This is required by Chrome's messaging API
        // if sendResponse might be called, even if it's called immediately.
        return true;
    });

    // ---- Initial Log ----
    console.log(`${LOG_PREFIX} Content script initialized and listening for commands.`); // Basic logging

    try {
        console.log(`${LOG_PREFIX} Sending 'content_script_ready' message to background.`);
        chrome.runtime.sendMessage({ action: "content_script_ready" }).catch(error => {
            // Fehler beim Senden der Bereitschaftsnachricht ist meist unkritisch,
            // kann aber auf Probleme mit dem Background-Skript hindeuten.
            console.warn(`${LOG_PREFIX} Could not send 'content_script_ready' message:`, error.message);
        });
    } catch (e) {
        console.error(`${LOG_PREFIX} Error sending initial ready message:`, e);
    }
})(); // End of IIFE