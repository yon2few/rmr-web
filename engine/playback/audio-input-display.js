// Audio Input Display Module - Handles text display and page management
class AudioSystemInputDataDisplay {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Display] player is required.');
        }
        this.player = player;
        this.clickToSeekManager = new ClickToSeekManager();
        this.pageLineBalancer = new PageLineBalancer();
        this.pageStartTimes = [];
        this.pageFlipTimes = [];
        this.pageStartTimesSource = null;
        this.pageStartsMonotonic = true;
        this.fullChunkScrollResizeObserver = null;
        this.fullChunkScrollMutationObserver = null;
        this.fullChunkScrollContainer = null;
    }

    resolvePagesForChunk(chunkIndex) {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
            throw new Error(`[Display] chunkIndex must be a non-negative integer. Received: ${chunkIndex}`);
        }

        const chunk = this.player.audioChunks?.[chunkIndex];
        if (!chunk || typeof chunk !== 'object') {
            throw new Error(`[Display] Chunk ${chunkIndex} is unavailable.`);
        }
        if (!Array.isArray(chunk.pages) || chunk.pages.length === 0) {
            throw new Error(`[Display] chunk.pages are required for chunk ${chunkIndex}.`);
        }

        return chunk.pages;
    }

    displayFullChunk(chunkIndex) {
        setTimeout(() => {
            this._displayFullChunkInternal(chunkIndex);
        }, 0);
    }
    
    _displayFullChunkInternal(chunkIndex) {
        const textDisplay = this.player.elements.fullChunkDisplay;
        if (!textDisplay) {
            throw new Error('[Display] FullChunk display element not found.');
        }

        // FullChunk view starts a fresh page-selection context for the next Play action.
        this.player.pendingPageSelectionForPlay = false;
        this.player.renderedChunkIndex = null;
        this.player.renderedPageIndex = null;
        this.disconnectFullChunkScrollableState();
        if (typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('fullchunk');
        }

        textDisplay.innerHTML = '';
        
        // Get fullChunkDisplay data for the specified chunk
        const chunk = this.player.audioChunks && this.player.audioChunks[chunkIndex];

        if (!chunk || !chunk.fullChunkDisplay || !chunk.fullChunkDisplay.displayElements) {
            throw new Error(`[Display] No fullChunkDisplay data for chunk ${chunkIndex}.`);
        }

        const displayElements = chunk.fullChunkDisplay.displayElements;
        const pagesForChunk = this.resolvePagesForChunk(chunkIndex);

        const textFlex = document.createElement('div');
        textFlex.className = 'text-flex';
        
        const textContent = document.createElement('div');
        textContent.className = 'text-content';

        // Build page boundaries from this chunk's pages, not global player.pages.
        if (pagesForChunk.length > 0) {
            const pageBoundaries = pagesForChunk.map((page, idx) => ({
                pageIndex: page.pageIndex ?? page.pageNumber ?? idx,
                startWordIndex: page.words[0].index,
                endWordIndex: page.words[page.words.length - 1].index,
                start: page.start,
                end: page.end
            }));
            
            // Helper: Add extra space after sentence-ending punctuation for better readability
            const addExtraSpaceAfterSentence = (container) => {
                const lastChild = container.lastChild;
                if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
                    const text = lastChild.textContent;
                    // If ends with sentence punctuation (. ! ? : ; -) followed by space, add another space
                    if (/[.!?:;-]\s$/.test(text)) {
                        lastChild.textContent = text + ' ';  // Add extra space (makes two total)
                    }
                }
            };
            
            let currentPageIndex = 0;
            let currentPageContainer = document.createElement('span');
            currentPageContainer.className = 'page-container';
            currentPageContainer.setAttribute('data-page-index', pageBoundaries[0].pageIndex);
            currentPageContainer.setAttribute('data-start-time', pageBoundaries[0].start);
            currentPageContainer.setAttribute('data-end-time', pageBoundaries[0].end);
            
            let pageElementCounts = {};
            
            // Process each display element and group into pages
            for (let i = 0; i < displayElements.length; i++) {
                const element = displayElements[i];
                
                // Check if we need to start a new page (when word belongs to next page)
                if (element.type === 'word' && currentPageIndex < pageBoundaries.length - 1) {
                    const currentBoundary = pageBoundaries[currentPageIndex];
                    const nextBoundary = pageBoundaries[currentPageIndex + 1];
                    
                    // If this word's index is beyond current page, start new page
                    if (element.wordIndex > currentBoundary.endWordIndex && 
                        element.wordIndex >= nextBoundary.startWordIndex) {
                        // Add extra space if page ends with sentence punctuation
                        addExtraSpaceAfterSentence(currentPageContainer);
                        
                        // Append current page to textContent
                        textContent.appendChild(currentPageContainer);
                        
                        // Start new page
                        currentPageIndex++;
                        currentPageContainer = document.createElement('span');
                        currentPageContainer.className = 'page-container';
                        currentPageContainer.setAttribute('data-page-index', pageBoundaries[currentPageIndex].pageIndex);
                        currentPageContainer.setAttribute('data-start-time', pageBoundaries[currentPageIndex].start);
                        currentPageContainer.setAttribute('data-end-time', pageBoundaries[currentPageIndex].end);
                    }
                }
                
                // Track element counts per page
                pageElementCounts[element.type] = (pageElementCounts[element.type] || 0) + 1;
                
                // Add element to current page container
                switch (element.type) {
                    case 'word':
                        // V2 parity in FullChunkDisplay: plain text-node flow for natural spacing
                        currentPageContainer.appendChild(document.createTextNode(element.word + ' '));
                        break;
                    
                    case 'paragraph-break':
                        const paragraphBreak = document.createElement('br');
                        currentPageContainer.appendChild(paragraphBreak);
                        const paragraphBreak2 = document.createElement('br');
                        paragraphBreak2.className = 'paragraph-break';
                        currentPageContainer.appendChild(paragraphBreak2);
                        break;
                    
                    case 'line-break':
                        const lineBreak = document.createElement('br');
                        lineBreak.className = 'line-break';
                        currentPageContainer.appendChild(lineBreak);
                        break;
                    
                    case 'bullet-item':
                        const bulletDiv = document.createElement('div');
                        bulletDiv.className = `list-item bullet-item indent-${element.indent || 0}`;
                        bulletDiv.setAttribute('data-bullet', element.bullet || '•');
                        bulletDiv.setAttribute('data-start-time', element.start ?? 0);
                        bulletDiv.setAttribute('data-word-index', element.wordIndex ?? element.index ?? 0);
                        bulletDiv.textContent = element.content;
                        currentPageContainer.appendChild(bulletDiv);
                        break;
                    
                    case 'numbered-item':
                        const numberedDiv = document.createElement('div');
                        numberedDiv.className = `list-item numbered-item indent-${element.indent || 0}`;
                        numberedDiv.setAttribute('data-number', element.number || '1.');
                        numberedDiv.setAttribute('data-start-time', element.start ?? 0);
                        numberedDiv.setAttribute('data-word-index', element.wordIndex ?? element.index ?? 0);
                        numberedDiv.textContent = element.content;
                        currentPageContainer.appendChild(numberedDiv);
                        break;
                }
            }
            
            // Add extra space if final page ends with sentence punctuation
            addExtraSpaceAfterSentence(currentPageContainer);
            
            // Append final page container
            if (currentPageContainer.childNodes.length > 0) {
                textContent.appendChild(currentPageContainer);
            }
        }
        
        // Build flex structure
        textFlex.appendChild(textContent);
        textDisplay.appendChild(textFlex);

        if (this.player.userNotPlayingFontSize) {
                    document.documentElement.style.setProperty(
                '--fullchunkdisplay-font-size',
                `${this.player.userNotPlayingFontSize}px`
            );
        }

        this.player.playbackAdapter.attachPageClickToSeek(textDisplay);
        this.connectFullChunkScrollableState(textContent);
        this.player.captioning.cacheCurrentWordElements();

        setTimeout(() => {
            this.updateFullChunkScrollableState(textContent);
            let pageToHighlight = 0;

            if (this.player.selectedWordStartTime !== undefined) {
                for (let i = 0; i < pagesForChunk.length; i++) {
                    const page = pagesForChunk[i];
                    if (this.player.selectedWordStartTime >= page.start &&
                        this.player.selectedWordStartTime <= page.end) {
                        pageToHighlight = i;
                        break;
                    }
                }
            }

            const page = pagesForChunk[pageToHighlight];
            if (!page) {
                throw new Error(`[Display] FullChunk page ${pageToHighlight} is missing for chunk ${chunkIndex}.`);
            }

            const pageContainer = this.player.elements.fullChunkDisplay.querySelector(
                `.page-container[data-page-index="${page.pageIndex ?? pageToHighlight}"]`
            );
            if (!pageContainer) {
                throw new Error(
                    `[Display] FullChunk page container is missing for chunk ${chunkIndex}, page ${page.pageIndex ?? pageToHighlight}.`
                );
            }

            this.player.playbackAdapter.setSelectedPage(
                pageContainer,
                pageToHighlight,
                this.player.playbackAdapter.getSelectedPageSeekTime(pageToHighlight),
                this.player.elements.fullChunkDisplay
            );
            this.player.pendingPageSelectionForPlay = true;
        }, 0);
        
        // Calculate optimal font size for all states
        setTimeout(() => this.calculateOptimalFontSize(), 100);

        if (typeof this.player.setOverlayActionState === 'function') {
            this.player.setOverlayActionState({
                mode: 'fullchunk',
                isPlaying: this.player.getIsPlaying(),
                hasAudio: this.player.computeHasAudio(),
                isGenerating: this.player.isGenerating,
                hasSavableState: this.player.computeHasSavableState(),
                canSave: this.player.computeHasSavableState(),
                canExport: this.player.computeHasCompleteLocalSession(),
                canReset: this.player.computeCanReset()
            });
        }
        
    }

    
    updateTextDisplayForPage(pageIndex, options = {}) {
            return this._updateTextDisplayForPageInternal(pageIndex, options);
    }
    
    _updateTextDisplayForPageInternal(pageIndex, options = {}) {
        const chunkIndex = this.player.currentChunkIndex;
        const pages = this.resolvePagesForChunk(chunkIndex);

        if (pageIndex < 0 || pageIndex >= pages.length) {
            throw new Error(
                `[Display] PageView page index ${pageIndex} is out of range for chunk ${chunkIndex} (${pages.length} pages).`
            );
        }

        const pageWords = pages[pageIndex].words;
        if (!Array.isArray(pageWords) || pageWords.length === 0) {
            throw new Error(`[Display] PageView page ${pageIndex} has no words for chunk ${chunkIndex}.`);
        }

        const textDisplay = this.player.elements.pageViewDisplay;
        if (!textDisplay) {
            throw new Error('[Display] PageView display element not found.');
        }

        const activateView = options.activateView !== false;

        this.player.currentPageIndex = pageIndex;

        // Set transition flag to prevent updates during transition
        if (!this.player.captioning) {
            throw new Error('[Display] captioning is required for PageView transitions.');
        }
        this.player.captioning.setTransitioningPage(true);
        this.player.captioning.takeCachedWordElements();

        // Keep the outgoing page visible (and its last-word highlight) while the
        // next page is built. Fading to 0 and wiping innerHTML first was dropping
        // ~150ms+ of audio with a blank page — highlight then started late on
        // every turn and fell further behind across the run.
        const renderPromise = new Promise((resolve, reject) => {
            let settled = false;
            const settleTransition = (error = null) => {
                if (settled) {
                    return;
                }
                settled = true;

                if (this.player.captioning) {
                    this.player.captioning.setTransitioningPage(false);
                }

                if (error) {
                    textDisplay.style.opacity = '1';
                    let rejection = error;
                    if (typeof this.player.captureSubsystemFailure === 'function') {
                        try {
                            rejection = this.player.captureSubsystemFailure('display', error, {
                                pageIndex,
                                chunkIndex,
                                context: 'page-render'
                            });
                        } catch (reportingError) {
                            console.error('[Display] captureSubsystemFailure failed while reporting page render error', {
                                pageIndex,
                                chunkIndex,
                                reportingError,
                                originalError: error
                            });
                        }
                    }
                    reject(rejection);
                    return;
                }

                resolve();
            };

            requestAnimationFrame(() => {
                try {
                    let textFlex = textDisplay.querySelector('.text-flex');
                    if (!textFlex) {
                        textFlex = document.createElement('div');
                        textFlex.className = 'text-flex';
                        textDisplay.appendChild(textFlex);
                    }
                    textFlex.style.position = 'relative';

                    // Build the next page offscreen, then swap. Do not tear down
                    // the live page until the replacement is balanced and ready.
                    const nextContainer = this.player.captioning.buildWordContainer(pageWords);
                    nextContainer.id = 'textContent-next';
                    nextContainer.style.visibility = 'hidden';
                    nextContainer.style.pointerEvents = 'none';
                    nextContainer.style.position = 'absolute';
                    nextContainer.style.left = '0';
                    nextContainer.style.top = '0';
                    nextContainer.style.width = '100%';

                    const previousContainer = textFlex.querySelector('.text-content');
                    textFlex.appendChild(nextContainer);

                    this.player.captioning.attachWordClickToSeek(textDisplay);

                    if (this.player.activeView !== 'pageview' && typeof this.player.setActiveView === 'function') {
                        this.player.setActiveView('pageview');
                    }

                    this.player.captioning.balanceWordContainer(nextContainer, () => {
                        try {
                            nextContainer.removeAttribute('style');
                            nextContainer.id = 'textContent';

                            if (previousContainer && previousContainer !== nextContainer) {
                                previousContainer.replaceWith(nextContainer);
                            }

                            this.player.captioning.cacheCurrentWordElements();
                            this.player.captioning.applyInitialWordHighlighting();
                            this.player.renderedChunkIndex = this.player.currentChunkIndex;
                            this.player.renderedPageIndex = pageIndex;

                            const audioEl = this.player.currentAudioElement;
                            if (audioEl && this.player.captioning) {
                                this.player.captioning.resetBlockState();
                            }
                            this.player.captioning.setTransitioningPage(false);

                            if (audioEl && this.player.captioning) {
                                this.player.captioning.updateWordHighlighting(audioEl.currentTime);
                                if (!audioEl.paused && typeof this.player.captioning.startHighlighting === 'function') {
                                    this.player.captioning.startHighlighting();
                                }
                            }

                            requestAnimationFrame(() => {
                                try {
                                    textDisplay.style.opacity = '1';
                                    if (activateView && typeof this.player.setActiveView === 'function') {
                                        this.player.setActiveView('pageview');
                                    }
                                    const audioEl = this.player.currentAudioElement;
                                    if (audioEl && this.player.captioning) {
                                        this.player.captioning.updateWordHighlighting(audioEl.currentTime);
                                    }
                                    if (audioEl && !audioEl.paused) {
                                        textDisplay.classList.add('playing');
                                        if (this.player.controls && typeof this.player.controls.activateDimming === 'function') {
                                            this.player.controls.activateDimming();
                                        }
                                    }
                                    if (this.player.playback && typeof this.player.playback.onPageRenderComplete === 'function') {
                                        this.player.playback.onPageRenderComplete(pageIndex);
                                    }
                                    if (typeof this.player.setOverlayActionState === 'function') {
                                        this.player.setOverlayActionState({
                                            mode: 'pageview',
                                            isPlaying: !!(audioEl && !audioEl.paused),
                                            hasAudio: this.player.computeHasAudio(),
                                            isGenerating: this.player.isGenerating,
                                            hasSavableState: this.player.computeHasSavableState(),
                                            canSave: this.player.computeHasSavableState(),
                                            canExport: this.player.computeHasCompleteLocalSession(),
                                            canReset: this.player.computeCanReset()
                                        });
                                    }
                                    settleTransition();
                                } catch (error) {
                                    settleTransition(error);
                                }
                            });
                        } catch (error) {
                            settleTransition(error);
                        }
                    });

                    setTimeout(() => {
                        // Restore user font size preferences if they exist (for PageView)
                        if (this.player.userPageViewModeFontSize) {
                            document.documentElement.style.setProperty(
                                '--pageviewmode-font-size',
                                `${this.player.userPageViewModeFontSize}px`
                            );
                        }
                    }, 50);
                } catch (error) {
                    settleTransition(error);
                }
            });
        });

        // Track the in-flight transition so callers that must not run while a page
        // is mid-render (e.g. the audio-ended handler looping back to chunk 0) can
        // await settlement instead of racing captioning.isTransitioningPage.
        this.player.pendingPageTransitionPromise = renderPromise;
        renderPromise.finally(() => {
            if (this.player.pendingPageTransitionPromise === renderPromise) {
                this.player.pendingPageTransitionPromise = null;
            }
        });

        if (activateView && this.player.activeView === 'pageview' && typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('pageview');
        }

        return renderPromise;

    }
    
    showPlaybackInterface() {
        this.disconnectFullChunkScrollableState();
        if (typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('fullchunk');
        }
        
        // Fade watermark when playback starts (but keep visible)
        const watermark = document.querySelector('.watermark');
        if (watermark) {
            watermark.style.opacity = '0.25';
        }

        if (typeof this.player.setOverlayActionState === 'function') {
            this.player.setOverlayActionState({
                mode: 'fullchunk',
                isPlaying: this.player.getIsPlaying(),
                hasAudio: this.player.computeHasAudio(),
                isGenerating: this.player.isGenerating,
                hasSavableState: this.player.computeHasSavableState(),
                canSave: this.player.computeHasSavableState(),
                canExport: this.player.computeHasCompleteLocalSession(),
                canReset: this.player.computeCanReset()
            });
        }
    }

    resolvePageFlipTimes(pages) {
        const timing = window.ArtReaderPageTurnTiming;
        if (!timing || typeof timing.resolvePageFlipTimes !== 'function') {
            throw new Error('[Display] ArtReaderPageTurnTiming.resolvePageFlipTimes is required.');
        }
        return timing.resolvePageFlipTimes(pages, window.ArtReaderHighlightingConfig);
    }

    syncPageStartCache(pages) {
        if (
            this.pageStartTimesSource === pages &&
            this.pageStartTimes.length === pages.length &&
            this.pageFlipTimes.length === pages.length
        ) {
            return;
        }

        this.pageStartTimesSource = pages;
        this.pageStartTimes = pages.map((page) => (typeof page?.start === 'number' ? page.start : 0));
        this.pageFlipTimes = this.resolvePageFlipTimes(pages);

        this.pageStartsMonotonic = true;
        for (let i = 1; i < this.pageFlipTimes.length; i++) {
            if (this.pageFlipTimes[i] < this.pageFlipTimes[i - 1]) {
                this.pageStartsMonotonic = false;
                break;
            }
        }
    }

    getCurrentPageForTime(currentTime, options = {}) {
        const pages = this.player.pages || [];
        if (!pages.length) return 0;

        const rawTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
        this.syncPageStartCache(pages);

        const timing = window.ArtReaderPageTurnTiming;
        if (!timing || typeof timing.lookupPageIndexForTime !== 'function') {
            throw new Error('[Display] ArtReaderPageTurnTiming.lookupPageIndexForTime is required.');
        }

        // Out-of-order page starts keep the old start-time walk.
        if (!this.pageStartsMonotonic) {
            const time = options.allowSeekUndershoot === true
                ? rawTime + timing.PAGE_START_EPSILON
                : rawTime;
            for (let i = pages.length - 1; i >= 0; i--) {
                if (time >= this.pageStartTimes[i]) return i;
            }
            return 0;
        }

        return timing.lookupPageIndexForTime(rawTime, pages, this.pageFlipTimes, options);
    }
    
    disconnectFullChunkScrollableState() {
        if (this.fullChunkScrollResizeObserver) {
            this.fullChunkScrollResizeObserver.disconnect();
            this.fullChunkScrollResizeObserver = null;
        }
        if (this.fullChunkScrollMutationObserver) {
            this.fullChunkScrollMutationObserver.disconnect();
            this.fullChunkScrollMutationObserver = null;
        }
        this.fullChunkScrollContainer = null;
    }

    updateFullChunkScrollableState(textContent) {
        if (!(textContent instanceof HTMLElement)) {
            throw new Error('[Display] FullChunk text content element is required.');
        }

        const canScroll = textContent.scrollHeight > textContent.clientHeight + 1;
        textContent.classList.toggle('is-scrollable', canScroll);
    }

    connectFullChunkScrollableState(textContent) {
        if (!(textContent instanceof HTMLElement)) {
            throw new Error('[Display] FullChunk text content element is required.');
        }
        if (typeof ResizeObserver !== 'function') {
            throw new Error('[Display] ResizeObserver is required for FullChunk scroll-state management.');
        }
        if (typeof MutationObserver !== 'function') {
            throw new Error('[Display] MutationObserver is required for FullChunk scroll-state management.');
        }

        this.disconnectFullChunkScrollableState();
        this.fullChunkScrollContainer = textContent;

        const syncScrollability = () => {
            if (this.fullChunkScrollContainer !== textContent) {
                return;
            }
            this.updateFullChunkScrollableState(textContent);
        };

        this.fullChunkScrollResizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(syncScrollability);
        });
        this.fullChunkScrollResizeObserver.observe(textContent);

        this.fullChunkScrollMutationObserver = new MutationObserver(() => {
            requestAnimationFrame(syncScrollability);
        });
        this.fullChunkScrollMutationObserver.observe(textContent, {
            childList: true,
            subtree: true,
            characterData: true
        });

        requestAnimationFrame(syncScrollability);
    }

    buildPageViewFontFitMeasurementHost(textDisplay) {
        if (!textDisplay) {
            throw new Error('[Display] PageView display element is required for font-fit measurement.');
        }

        const computedStyle = window.getComputedStyle(textDisplay);
        const measurementHost = document.createElement('div');
        measurementHost.style.position = 'absolute';
        measurementHost.style.top = computedStyle.paddingTop;
        measurementHost.style.right = computedStyle.paddingRight;
        measurementHost.style.bottom = computedStyle.paddingBottom;
        measurementHost.style.left = computedStyle.paddingLeft;
        measurementHost.style.visibility = 'hidden';
        measurementHost.style.pointerEvents = 'none';
        measurementHost.style.overflow = 'hidden';
        measurementHost.style.zIndex = '-1';
        measurementHost.style.display = 'block';
        measurementHost.style.boxSizing = 'border-box';
        measurementHost.style.fontFamily = computedStyle.fontFamily;
        measurementHost.style.lineHeight = computedStyle.lineHeight;
        return measurementHost;
    }

    measurePageViewHeightForFontSize(pageIndex, fontSizePx) {
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= this.player.pages.length) {
            throw new Error(`[Display] Invalid page index ${pageIndex} for pageview font-fit measurement.`);
        }
        if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) {
            throw new Error('[Display] fontSizePx must be a positive number for pageview font-fit measurement.');
        }

        const textDisplay = this.player.elements.pageViewDisplay;
        if (!textDisplay) {
            throw new Error('[Display] PageView display element not found for font-fit measurement.');
        }

        const pageWords = this.player.pages[pageIndex].words;
        const measurementHost = this.buildPageViewFontFitMeasurementHost(textDisplay);
        measurementHost.style.fontSize = `${fontSizePx}px`;
        textDisplay.appendChild(measurementHost);

        try {
            const textContent = this.clickToSeekManager.processWords(
                pageWords,
                measurementHost,
                this.player,
                false
            );
            measurementHost.appendChild(textContent);
            this.pageLineBalancer.optimizeLineBalance(textContent);
            return {
                contentHeight: Math.ceil(textContent.getBoundingClientRect().height),
                availableHeight: measurementHost.clientHeight
            };
        } finally {
            measurementHost.remove();
        }
    }

    resolveMaxPageViewFontSizeThatFits(pageIndex, upperBoundPx) {
        const minSize = this.player.readRootPixelVariable('--pageviewmode-font-size-min');
        const normalizedUpperBound = Math.max(minSize, Math.floor(upperBoundPx));
        let low = minSize;
        let high = normalizedUpperBound;
        let bestFit = minSize;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const { contentHeight, availableHeight } = this.measurePageViewHeightForFontSize(pageIndex, mid);
            if (contentHeight <= availableHeight) {
                bestFit = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        return bestFit;
    }

    snapCurrentPageViewFontSizeToFit(pageIndex, liveUpperBoundPx) {
        const snappedSize = this.resolveMaxPageViewFontSizeThatFits(pageIndex, liveUpperBoundPx);
        document.documentElement.style.setProperty('--pageviewmode-font-size', `${snappedSize}px`);
        this.player.userPageViewModeFontSize = snappedSize;
        this._updateTextDisplayForPageInternal(pageIndex);
    }
    
    calculateOptimalFontSize() {
        // Dynamic font sizing now handled by dev panel controls
        // This function preserved for compatibility but functionality moved to dev controls
        // No longer needed - font sizes controlled by dev panel
    }
}
