/*
    Midjourney Exporter (Enhanced with Single Action Column)

    Purpose: Scrapes job data (prompt, parameters, image URL, action keyword)
             from the currently loaded Midjourney page and downloads it as a CSV file.
             Includes a single 'action' column for keywords like Upscale/Zoom.

    Usage:   Paste this entire script into your browser's developer console and execute it
             while viewing your Midjourney job history (https://www.midjourney.com/imagine).

    Notes:   DOM selectors may need updates if Midjourney changes its website structure.
*/

(function() {
    'use strict';

    // ---- Configuration ----

    const SELECTORS = {
        jobContainer: 'div.absolute.flex-col.grid[class*="grid-cols"]',
        promptWrapper: 'div.relative.group\\/promptText',
        promptSpan: 'span.relative',
        promptFallback: 'div.overflow-clip.flex.relative span.relative',
        actionSpan: '.text-splash\\/90', // Span containing action keywords
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
    };
    const LOG_PREFIX = '[Exporter Single Action]';


    // ---- Helper Functions ----

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
        console.log(`${LOG_PREFIX} Download initiated for: ${filename}`);
    }

    /* Escape CSV Field */
    function escapeCsvField(field) {
        if (field === null || field === undefined) {
            return '""';
        }
        const stringField = String(field);
        if (stringField.includes(',') || stringField.includes('\n') || stringField.includes('"')) {
             return `"${stringField.replace(/"/g, '""')}"`;
        }
        return stringField;
    }


    // ---- Data Extraction Functions ----

    /* Extract Raw Prompt Text */
    function extractRawPromptText(jobContainer) {
        const promptWrapper = jobContainer.querySelector(SELECTORS.promptWrapper);
        let fullPromptText = null;
        if (promptWrapper) {
             fullPromptText = promptWrapper.querySelector('.break-word')?.textContent?.trim();
             if (!fullPromptText) {
                  fullPromptText = promptWrapper.querySelector(SELECTORS.promptSpan)?.textContent?.trim();
             }
        }
        if (!fullPromptText) {
            fullPromptText = jobContainer.querySelector(SELECTORS.promptFallback)?.textContent?.trim();
        }
        return fullPromptText ?? DEFAULT_VALUES.prompt;
    }

    /* Extract Parameters */
    function extractParameters(jobContainer) {
        const jobParams = {};
        const potentialParamsContainers = Array.from(jobContainer.querySelectorAll(SELECTORS.paramsContainer));
        const paramsContainer = potentialParamsContainers.find(container => container.querySelector(SELECTORS.paramButton));
        if (!paramsContainer) return jobParams;
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
            if (paramName && !paramValue) paramValue = "true";
            if (paramName) jobParams[paramName] = paramValue;
        });
        return jobParams;
    }

    /* Extract Image Data */
    function extractImageData(jobContainer) {
        const imageData = [];
        const imageGridContainer = jobContainer.querySelector(SELECTORS.imageGrid);
        if (!imageGridContainer) return imageData;
        const imageLinks = imageGridContainer.querySelectorAll(SELECTORS.imageLink);
        imageLinks.forEach(link => {
            const imgElement = link.querySelector(SELECTORS.imageElement);
            const src = imgElement?.getAttribute('src');
            if (!src) return;
            const jobIdMatch = src.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\//i);
            const jobId = jobIdMatch?.[1] ?? DEFAULT_VALUES.jobId;
            const pngSrc = src.split('?')[0]?.replace(/\.webp$/i, '.png') ?? DEFAULT_VALUES.pngSrc;
            imageData.push({ jobId, pngSrc });
        });
        return imageData;
    }


    // ---- Main Execution Logic ----

    function runManualExport() {
        console.log(`${LOG_PREFIX} Starting manual export process...`);

        console.log(`${LOG_PREFIX} Phase 1: Analyzing loaded containers...`);
        const allJobContainers = document.querySelectorAll(SELECTORS.jobContainer);
        console.log(`${LOG_PREFIX} Found ${allJobContainers.length} potential job containers.`);

        if (allJobContainers.length === 0) {
            alert("No job containers found. Ensure you've scrolled to load jobs...");
            console.error(`${LOG_PREFIX} No job containers found: ${SELECTORS.jobContainer}`);
            return;
        }

        const allParamNames = new Set();
        const intermediateData = [];

        allJobContainers.forEach((jobContainer, index) => {
            const rawPromptText = extractRawPromptText(jobContainer);
            const jobParams = extractParameters(jobContainer);
            const imagesData = extractImageData(jobContainer);

            let actionKeyword = null;
            let cleanedPrompt = rawPromptText;
            const promptWrapper = jobContainer.querySelector(SELECTORS.promptWrapper);

            if (promptWrapper && rawPromptText !== DEFAULT_VALUES.prompt) {
                 const actionSpan = promptWrapper.querySelector(SELECTORS.actionSpan);
                 if (actionSpan) {
                     const foundKeyword = actionSpan.textContent?.trim();
                     if (foundKeyword && rawPromptText.startsWith(foundKeyword)) {
                         actionKeyword = foundKeyword;
                         cleanedPrompt = rawPromptText.substring(actionKeyword.length).trim();
                     }
                 }
            }

            Object.keys(jobParams).forEach(paramName => allParamNames.add(paramName));

            if (imagesData.length > 0) {
                imagesData.forEach(imgData => {
                    intermediateData.push({
                        ...imgData,
                        prompt: cleanedPrompt,
                        jobParams: jobParams,
                        actionKeyword: actionKeyword
                    });
                });
            } else if (rawPromptText !== DEFAULT_VALUES.prompt || Object.keys(jobParams).length > 0) {
                console.warn(`${LOG_PREFIX} Container ${index + 1} has prompt/params but no image.`);
                intermediateData.push({
                    jobId: DEFAULT_VALUES.jobId,
                    pngSrc: DEFAULT_VALUES.pngSrc,
                    prompt: cleanedPrompt,
                    jobParams: jobParams,
                    actionKeyword: actionKeyword
                });
            }
        });

        console.log(`${LOG_PREFIX} Analysis complete. Found ${intermediateData.length} data entries.`);
        if (allParamNames.size > 0) {
            console.log(`${LOG_PREFIX} Found unique parameter names: ${Array.from(allParamNames).sort().join(', ')}`);
        } else {
             console.log(`${LOG_PREFIX} No parameters found.`);
        }


        // ---- PHASE 2: Build CSV ----
        if (intermediateData.length === 0) {
            alert("No data extracted. Check selectors or page structure.");
            // SYNTAX FIX: Added closing parenthesis ')' to the console.error call
            console.error(`${LOG_PREFIX} No processable data collected.`);
            return;
        }

        const sortedParamNames = Array.from(allParamNames).sort();
        const header = ['job_id', 'url', 'prompt', 'action', ...sortedParamNames];
        const csvRows = [];

        csvRows.push(header.map(escapeCsvField).join(','));
        console.log(`${LOG_PREFIX} CSV Header: ${header.join(', ')}`);

        intermediateData.forEach(entry => {
            const rowData = [
                escapeCsvField(entry.jobId),
                escapeCsvField(entry.pngSrc),
                escapeCsvField(entry.prompt),
            ];
            const actionValue = escapeCsvField(entry.actionKeyword);
            const paramValues = sortedParamNames.map(colName => {
                const value = entry.jobParams[colName];
                return escapeCsvField(value ?? '');
            })
            csvRows.push([...rowData, actionValue, ...paramValues].join(','));
        });

        console.log(`${LOG_PREFIX} CSV data prepared with ${csvRows.length} rows (incl. header).`);


        // ---- Generate and Download CSV ----
        if (csvRows.length > 1) {
            const finalCSV = csvRows.join('\n');
            const filename = `midjourney_single_action_export_${new Date().toISOString().slice(0, 10)}.csv`;
            console.log(`${LOG_PREFIX} Attempting download...`);
            downloadCSV(finalCSV, filename);
            console.log(`${LOG_PREFIX} Exported ${intermediateData.length} data entries.`);
        } else {
            alert('Error creating CSV data.');
            console.error(`${LOG_PREFIX} CSV generation failed.`);
        }
    }

    // ---- Script Execution ----
    try {
        runManualExport();
    } catch (error) {
        console.error(`${LOG_PREFIX} Unexpected error:`, error);
        alert(`${LOG_PREFIX} Error occurred. Check console (F12). Error: ${error.message}`);
    }

})(); // End of IIFE