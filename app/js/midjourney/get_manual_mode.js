/*
    Midjourney Exporter

    Purpose: Scrapes job data (prompt, parameters, image URL) from the currently loaded
             Midjourney page in the browser and downloads it as a CSV file.

    Usage:   Paste this entire script into your browser's developer console and execute it
             while viewing your Midjourney job history (https://www.midjourney.com/imagine).

    Notes:   DOM selectors may need updates if Midjourney changes its website structure.
*/

(function() {
    'use strict';

    // ---- Configuration ----

    // DOM Selectors: These might need updating if Midjourney changes its website structure.
    const SELECTORS = {
        jobContainer: 'div.absolute.flex-col.grid[class*="grid-cols"]',     // Main container for a job/grid
        promptWrapper: 'div.relative.group\\/promptText',                   // Primary prompt location
        promptSpan: 'span.relative',                                        // Span inside the primary wrapper
        promptFallback: 'div.overflow-clip.flex.relative span.relative',    // Fallback prompt location
        paramsContainer: 'div.flex.flex-wrap.gap-1.empty\\:hidden',         // Container for parameter buttons
        paramButton: 'button',                                              // Buttons holding parameters
        paramNameSpan: 'span.opacity-80 > span.opacity-80',                 // Inner span containing the parameter name (e.g., "--ar")
        paramValueSibling: 'span:not(.opacity-80)',                         // Potential sibling span containing part of the value
        imageGrid: 'div.grid.gap-\\[1px\\], div.grid.lg\\:gap-2',           // Container for the image(s)
        imageLink: 'div.relative.group > a',                                // Link surrounding the image
        imageElement: 'img[src*="cdn.midjourney.com/"]',                    // The actual image element
    };

    // Constants
    const DEFAULT_VALUES = {
        prompt: 'PROMPT_NOT_FOUND',
        jobId: 'ID_NOT_FOUND',
        pngSrc: 'NO_IMAGE_SRC',
    };
    const LOG_PREFIX = '[Exporter Manual]';


    // ---- Helper Functions ----

    /*
        Creates a CSV file from a string and initiates download.

        @param {string} csvContent - The CSV data as a single string.
        @param {string} filename - The desired name for the downloaded file.
    */
    function downloadCSV(csvContent, filename) {
        // UTF-8 BOM to ensure Excel compatibility with special characters
        const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');

        downloadLink.style.display = 'none';
        downloadLink.href = url;
        downloadLink.download = filename;

        document.body.append(downloadLink);
        downloadLink.click();

        // Clean up
        downloadLink.remove();
        window.URL.revokeObjectURL(url);
        console.log(`${LOG_PREFIX} Download initiated for: ${filename}`);
    }

    /*
        Escapes a string for use in a CSV field according to RFC 4180.
        Wraps the string in double quotes and doubles any existing double quotes.
        @param {string} field - The string to escape.
        @returns {string} The escaped string, ready for CSV.
    */
    function escapeCsvField(field) {
        if (field === null || field === undefined) {
            return '""';
        }
        const stringField = String(field);
        // Replace all double quotes with two double quotes, then wrap in double quotes
        return `"${stringField.replace(/"/g, '""')}"`;
    }


    // ---- Data Extraction Functions ----

    /*
        Extracts the prompt text from a job container element.
        @param {Element} jobContainer - The DOM element representing a single job.
        @returns {string} The extracted prompt text, or a default value if not found.
    */
    function extractPrompt(jobContainer) {
        const promptWrapper = jobContainer.querySelector(SELECTORS.promptWrapper);
        let promptText = null;

        if (promptWrapper) {
            // Optional chaining for resilience
            promptText = promptWrapper.querySelector(SELECTORS.promptSpan)?.textContent?.trim();
        }

        // Fallback if the primary structure isn't found
        if (!promptText) {
            promptText = jobContainer.querySelector(SELECTORS.promptFallback)?.textContent?.trim();
        }

        // Nullish coalescing for default value
        return promptText ?? DEFAULT_VALUES.prompt;
    }

    /*
        Extracts parameters (like --ar, --v) from a job container element.
        @param {Element} jobContainer - The DOM element representing a single job.
        @returns {object} An object where keys are parameter names (e.g., "--ar") and values are their values.
    */
    function extractParameters(jobContainer) {
        const jobParams = {};
        // Convert NodeList to Array to use find method
        const potentialParamsContainers = Array.from(jobContainer.querySelectorAll(SELECTORS.paramsContainer));

        // Find the specific container that actually contains parameter buttons
        const paramsContainer = potentialParamsContainers.find(container => container.querySelector(SELECTORS.paramButton));

        // Return empty object if no parameter container found
        if (!paramsContainer) {
            return jobParams;
        }

        const buttons = paramsContainer.querySelectorAll(SELECTORS.paramButton);

        buttons.forEach(button => {
            const nameSpan = button.querySelector(SELECTORS.paramNameSpan);
            if (!nameSpan) return;                                          // Skip button if name span isn't structured as expected

            const paramName = nameSpan.textContent?.trim();
            if (!paramName) return;                                         // Skip if name is empty

            // Complex logic to extract value from (text nodes and specific spans)
            let paramValue = '';
            let currentNode = nameSpan.nextSibling;                         // Start checking siblings *after* the name span

            while (currentNode) {
                if (currentNode.nodeType === Node.TEXT_NODE) {
                    // Append text content from text node siblings
                    paramValue += currentNode.textContent.trim();
                } else if (currentNode.nodeType === Node.ELEMENT_NODE && currentNode.matches(SELECTORS.paramValueSibling)) {
                    // Append text content from specific non-name span siblings
                    paramValue += currentNode.textContent.trim();
                }
                currentNode = currentNode.nextSibling;
            }

            paramValue = paramValue.trim();

            // Handle parameters that are flags (exist but have no value, e.g., --style raw) and assign 'true' as the value
            if (paramName && !paramValue) {
                paramValue = "true";
            }

            if (paramName) {
                jobParams[paramName] = paramValue;
            }
        });

        return jobParams;
    }

    /*
        Extracts image URLs and Job IDs from a job container element.
        Can handle multiple images within the same container if the structure allows.
        @param {Element} jobContainer - The DOM element representing a single job.
        @returns {Array<object>} An array of objects, each containing { jobId, pngSrc }.

        Returns empty if no valid images found.
    */
    function extractImageData(jobContainer) {
        const imageData = [];
        const imageGridContainer = jobContainer.querySelector(SELECTORS.imageGrid);

        // Exit if no image grid container
        if (!imageGridContainer) return imageData;

        // Find all links potentially containing images
        const imageLinks = imageGridContainer.querySelectorAll(SELECTORS.imageLink);

        imageLinks.forEach(link => {
            const imgElement = link.querySelector(SELECTORS.imageElement);

            // Use optional chaining
            const src = imgElement?.getAttribute('src');

            // Skip if no image element or src attribute
            if (!src) return;

            // Extract Job ID (UUID) using regex and optional chaining/nullish coalescing
            const jobIdMatch = src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\//i);
            const jobId = jobIdMatch?.[1] ?? DEFAULT_VALUES.jobId;

            // Convert .webp URLs to .png
            const pngSrc = src.split('?')[0]?.replace(/\.webp$/i, '.png') ?? DEFAULT_VALUES.pngSrc;

            imageData.push({ jobId, pngSrc });
        });

        return imageData;
    }


    // ---- Main Execution Logic ----

    function runManualExport() {
        console.log(`${LOG_PREFIX} Starting manual export process...`);

        // ---- PHASE 1: Analyze ALL loaded containers ----
        console.log(`${LOG_PREFIX} Phase 1: Analyzing loaded containers...`);
        const allJobContainers = document.querySelectorAll(SELECTORS.jobContainer);
        console.log(`${LOG_PREFIX} Found ${allJobContainers.length} potential job containers in current DOM.`);

        if (allJobContainers.length === 0) {
            alert("No job containers found. Ensure you've scrolled to load jobs and are on a Midjourney page displaying jobs (like Archive or your user feed).");
            console.error(`${LOG_PREFIX} No job containers found using selector: ${SELECTORS.jobContainer}`);
            return; // Exit if no containers found
        }

        const allParamNames = new Set();                                    // To collect unique parameter names across all jobs
        const intermediateData = [];                                        // To store {jobId, pngSrc, prompt, jobParams} for each extracted image

        allJobContainers.forEach((jobContainer, index) => {
            const prompt = extractPrompt(jobContainer);
            const jobParams = extractParameters(jobContainer);
            const imagesData = extractImageData(jobContainer);

            // Add all found parameter names from this job to the global set
            Object.keys(jobParams).forEach(paramName => allParamNames.add(paramName));

            if (imagesData.length > 0) {
                // Create a distinct entry for each image found within the container
                imagesData.forEach(imgData => {
                    intermediateData.push({
                        ...imgData,                                         // Includes jobId, pngSrc
                        prompt: prompt,
                        jobParams: jobParams,                               // Add the common prompt and params
                    });
                });
            } else if (prompt !== DEFAULT_VALUES.prompt || Object.keys(jobParams).length > 0) {
                /*
                    If no image was found, but we did find a prompt or parameters,
                    still record the entry with default image data.

                    This might capture text prompts or errors.
                */
                console.warn(`${LOG_PREFIX} Container ${index + 1} has prompt/params but no valid image found. Storing entry with default image data.`);
                intermediateData.push({
                    jobId: DEFAULT_VALUES.jobId,
                    pngSrc: DEFAULT_VALUES.pngSrc,
                    prompt: prompt,
                    jobParams: jobParams,
                });
            };
        });

        console.log(`${LOG_PREFIX} Analysis complete. Found ${intermediateData.length} data entries.`);
        if (allParamNames.size > 0) {
            console.log(`${LOG_PREFIX} Found unique parameter names: ${Array.from(allParamNames).sort().join(', ')}`);
        } else {
             console.log(`${LOG_PREFIX} No parameters found in any job.`);
        }


        // ---- PHASE 2: Build CSV from collected data ----
        if (intermediateData.length === 0) {
            alert("No data could be extracted from the found containers. Check the script's selectors or if the page structure has changed.");
            console.error(`${LOG_PREFIX} No processable data collected, cannot generate CSV.`);
            return;
        }

        // Sort parameter names alphabetically for consistent column order
        const sortedParamNames = Array.from(allParamNames).sort();

        // Define base headers plus the dynamic parameter headers
        const header = ['job_id', 'url', 'prompt', ...sortedParamNames];
        const csvRows = [];

        // Add the header row to CSV data, ensuring each header field is properly escaped
        csvRows.push(header.map(escapeCsvField).join(','));
        console.log(`${LOG_PREFIX} CSV Header generated: ${header.join(', ')}`);

        // Add data rows
        intermediateData.forEach(entry => {
            // Start row with the fixed columns, escaping each field
            const rowData = [
                escapeCsvField(entry.jobId),
                escapeCsvField(entry.pngSrc),
                escapeCsvField(entry.prompt),
            ];

            // Generate values for the parameter columns in the correct sorted order
            const paramValues = sortedParamNames.map(colName => {

                // Get the value for this parameter from the current entry's jobParams
                const value = entry.jobParams[colName];

                // Escape the value; use empty string '' if the parameter doesn't exist for this job
                return escapeCsvField(value ?? '');
            });

            // Combine the fixed data and parameter data, join into a CSV row string
            csvRows.push([...rowData, ...paramValues].join(','));
        });

        console.log(`${LOG_PREFIX} CSV data prepared with ${csvRows.length} rows (including header).`);


        // ---- Generate and Download CSV ----

        // Check if there is data beyond the header row
        if (csvRows.length > 1) {

            // Join all rows with newline characters
            const finalCSV = csvRows.join('\n');

            // Generate a filename with the current date
            const filename = `midjourney_manual_export_${new Date().toISOString().slice(0, 10)}.csv`;
            console.log(`${LOG_PREFIX} Attempting download...`);
            downloadCSV(finalCSV, filename);

            // Log success message (download initiation is logged within downloadCSV)
            console.log(`${LOG_PREFIX} Exported ${intermediateData.length} data entries.`);
        } else {
            /*
                This case should ideally not be reached if intermediateData was not empty,
                but serves as a fallback safety check.
            */
            alert('Error creating CSV data or no data rows available after processing.');
            console.error(`${LOG_PREFIX} Final CSV generation failed or yielded no data rows besides the header.`);
        }
    }

    // ---- Script Execution ----

    try {
        runManualExport();
    } catch (error) {
        console.error(`${LOG_PREFIX} An unexpected error occurred during script execution:`, error);
        alert(`${LOG_PREFIX} An error occurred while running the exporter. Check the browser console (F12) for details. Error: ${error.message}`);
    }

})(); // End of IIFE