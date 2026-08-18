// Audio Controls Module - Play/pause/seek controls
class AudioControls {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Controls] player is required.');
        }
        this.player = player;
        this.dimmingDiv = null;
        this.dimmingOpacity = 85; // Default opacity percentage
        this.isDimmingActive = false;
        this.speedDisplayTimeout = null;
        // Same 300ms comprehension hold as highlighting config pageTurnHoldMs.
        this.pageSelectionPlayDelayMs = 300;
        
        // [NEW] Track last save time for bookmarking
        this.lastSaveTime = 0;

        this.mobileGestureState = null;
        this.mobileGestureActivationPx = 18;
        this.mobileGestureStepPx = 24;
        this.mobileGestureSwipeMinPx = 48;
        this.trackpadPinchAccumulator = 0;
        this.trackpadPinchStepPx = 10;
        this.createDimmingDiv();
    }

    createDimmingDiv() {
        // Create full-screen dimming overlay
        this.dimmingDiv = document.createElement('div');
        this.dimmingDiv.id = 'backgroundDimmer';
        this.dimmingDiv.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background-color: #000000;
            opacity: 0;
            pointer-events: none;
            z-index: 5;
            transition: opacity 0.3s ease;
            display: none;
        `;
        
        // Add to body
        document.body.appendChild(this.dimmingDiv);
    }
    
    activateDimming() {
        if (this.isDimmingActive) return;

        // Dimming div should already be created and visible for live preview
        if (this.dimmingDiv) {
            this.dimmingDiv.style.display = 'block';
            this.dimmingDiv.style.opacity = this.dimmingOpacity / 100;
            this.isDimmingActive = true;

            const actionBar = document.getElementById('overlayActions');
            if (actionBar) {
                actionBar.classList.add('playback-dim');
            }
        }
    }

    dimPlaybackChrome() {
        const headerLeft = document.querySelector('.header-left');
        if (headerLeft) {
            headerLeft.classList.add('playback-dim');
        }
        const headerCenter = document.querySelector('.header-center');
        if (headerCenter) {
            headerCenter.classList.add('playback-dim');
        }
        this.activateDimming();
    }

    clearPlaybackChromeDimming() {
        const headerLeft = document.querySelector('.header-left');
        if (headerLeft) {
            headerLeft.classList.remove('playback-dim');
        }
        const headerCenter = document.querySelector('.header-center');
        if (headerCenter) {
            headerCenter.classList.remove('playback-dim');
        }
        this.deactivateDimming();
    }
    
    deactivateDimming() {
        if (!this.dimmingDiv || !this.isDimmingActive) return;

        this.dimmingDiv.style.opacity = '0';
        this.isDimmingActive = false;

        const actionBar = document.getElementById('overlayActions');
        if (actionBar) {
            actionBar.classList.remove('playback-dim');
        }
    }
    
    setupEventListeners() {
        // Keyboard controls for playback speed (0.5% steps) and font size
        document.addEventListener('keydown', (e) => {
            const eventTarget = e.target;
            const targetTagName = eventTarget && typeof eventTarget.tagName === 'string'
                ? eventTarget.tagName
                : '';
            const isEditableField = ['INPUT', 'TEXTAREA'].includes(targetTagName);

            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.player.canAdjustReadableTextSize()) {
                e.preventDefault();
                this.adjustFontSize(e.key === 'ArrowUp' ? 1 : -1);
                return;
            }

            if ((e.code === 'Space' || e.key === ' ') && !isEditableField) {
                const view = this.player.activeView;
                if (
                    (view === 'fullchunk' || view === 'pageview') &&
                    this.player.currentAudioElement &&
                    !this.player.isGenerating
                ) {
                    e.preventDefault();
                    this.handleSpacebarPlaybackAction();
                }
                return;
            }

            if (this.player.currentAudioElement && !isEditableField) {
                const audio = this.player.currentAudioElement;
                const isPlaying = !audio.paused;
                const view = this.player.activeView;
                const canPageWhilePaused =
                    !isPlaying &&
                    (view === 'pageview' || view === 'fullchunk') &&
                    !this.player.isGenerating;

                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    if (canPageWhilePaused) {
                        this.handleKeyboardNav(e.key === 'ArrowLeft' ? -1 : 1);
                        return;
                    }
                    const delta = e.key === 'ArrowLeft' ? -0.01 : 0.01;
                    this.setPlaybackSpeed(this.player.playbackSpeed + delta);
                }
            }
        });

        this.setupMobileGestureListeners();
        this.setupTrackpadPinchListeners();
    }

    setupTrackpadPinchListeners() {
        // On macOS trackpad, pinch gestures arrive as wheel events with ctrlKey=true.
        // deltaY > 0 = pinch in (shrink), deltaY < 0 = spread out (enlarge).
        document.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            if (!this.player.canAdjustReadableTextSize()) return;

            e.preventDefault();

            this.trackpadPinchAccumulator += e.deltaY;

            const steps = Math.trunc(this.trackpadPinchAccumulator / this.trackpadPinchStepPx);
            if (steps === 0) return;

            this.trackpadPinchAccumulator -= steps * this.trackpadPinchStepPx;
            // pinch-in (positive deltaY) shrinks → negative delta for font
            this.adjustFontSize(-steps);
        }, { passive: false });
    }

    setupMobileGestureListeners() {
        if (this.player.shellVariant?.includesTouchGestures !== true) {
            return;
        }

        const pageViewGestureLayer = this.player.elements?.pageViewGestureLayer;
        if (!pageViewGestureLayer) {
            throw new Error('[Controls] Missing required #pageViewGestureLayer for pageview mobile gestures.');
        }

        pageViewGestureLayer.addEventListener('touchstart', (event) => {
            this.handlePageViewGestureStart(event);
        }, { passive: true });

        pageViewGestureLayer.addEventListener('touchmove', (event) => {
            this.handlePageViewGestureMove(event);
        }, { passive: false });

        pageViewGestureLayer.addEventListener('touchend', (event) => {
            this.handleMobileGestureEnd(event, 'pageview');
        }, { passive: true });

        pageViewGestureLayer.addEventListener('touchcancel', (event) => {
            this.handleMobileGestureEnd(event, 'pageview', { cancelled: true });
        }, { passive: true });

        document.addEventListener('touchstart', (event) => {
            this.handleFullChunkMobileGestureStart(event);
        }, { passive: true });

        document.addEventListener('touchmove', (event) => {
            this.handleFullChunkMobileGestureMove(event);
        }, { passive: false });

        document.addEventListener('touchend', (event) => {
            this.handleMobileGestureEnd(event, 'fullchunk');
        }, { passive: true });

        document.addEventListener('touchcancel', (event) => {
            this.handleMobileGestureEnd(event, 'fullchunk', { cancelled: true });
        }, { passive: true });
    }

    isFullChunkMobileGestureEligible(clientY) {
        if (this.player.shellVariant?.includesTouchGestures !== true) {
            return false;
        }

        const activeView = this.player.activeView;
        if (activeView !== 'fullchunk') {
            return false;
        }

        const overlay = document.getElementById('builtin-overlay');
        if (!overlay) {
            throw new Error('[Controls] Missing required #builtin-overlay for mobile gesture handling.');
        }

        const overlayRect = overlay.getBoundingClientRect();
        return clientY >= overlayRect.bottom && clientY <= window.innerHeight;
    }

    createMobileGestureState(touch, source) {
        return {
            source,
            activeView: this.player.activeView,
            startX: touch.clientX,
            startY: touch.clientY,
            fontStepsApplied: 0,
            mode: null
        };
    }

    handlePageViewGestureStart(event) {
        if (event.touches.length !== 1) {
            this.mobileGestureState = null;
            return;
        }
        if (this.player.shellVariant?.includesTouchGestures !== true) {
            this.mobileGestureState = null;
            return;
        }
        if (this.player.activeView !== 'pageview') {
            this.mobileGestureState = null;
            return;
        }

        this.mobileGestureState = this.createMobileGestureState(event.touches[0], 'pageview');
    }

    handleFullChunkMobileGestureStart(event) {
        if (event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        if (!this.isFullChunkMobileGestureEligible(touch.clientY)) {
            return;
        }

        this.mobileGestureState = this.createMobileGestureState(touch, 'fullchunk');
    }

    handlePageViewGestureMove(event) {
        if (this.mobileGestureState?.source !== 'pageview') {
            return;
        }
        this.handleMobileGestureMove(event);
    }

    handleFullChunkMobileGestureMove(event) {
        if (this.mobileGestureState?.source !== 'fullchunk') {
            return;
        }
        this.handleMobileGestureMove(event);
    }

    handleMobileGestureMove(event) {
        const state = this.mobileGestureState;
        if (!state || event.touches.length !== 1) {
            return;
        }

        const touch = event.touches[0];
        const deltaX = touch.clientX - state.startX;
        const deltaY = touch.clientY - state.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (!state.mode) {
            if (Math.max(absX, absY) < this.mobileGestureActivationPx) {
                return;
            }

            // Horizontal = page/chunk swipe nav; vertical = font size.
            state.mode = absX > absY ? 'nav' : 'font';
        }

        if (state.mode === 'font') {
            const fontSteps = Math.trunc((-deltaY) / this.mobileGestureStepPx);
            const deltaSteps = fontSteps - state.fontStepsApplied;

            if (deltaSteps !== 0) {
                this.adjustFontSize(deltaSteps);
                state.fontStepsApplied = fontSteps;
            }

            event.preventDefault();
            return;
        }

        event.preventDefault();
    }

    handleMobileGestureEnd(event, expectedSource, options = {}) {
        const state = this.mobileGestureState;
        if (!state || state.source !== expectedSource) {
            return;
        }

        const cancelled = options.cancelled === true;
        if (!cancelled && state.mode === 'nav') {
            const touch = event.changedTouches?.[0];
            if (!touch) {
                throw new Error('[Controls] Mobile nav swipe ended without a changed touch.');
            }

            const deltaX = touch.clientX - state.startX;
            if (Math.abs(deltaX) >= this.mobileGestureSwipeMinPx) {
                // Swipe left → next; swipe right → previous.
                this.stepNav(deltaX < 0 ? 1 : -1);
            }
        }

        this.mobileGestureState = null;
    }

    setupAudioEventListeners() {
        if (!this.player.currentAudioElement) return;
        
        const audio = this.player.currentAudioElement;

        // Idempotency: if listeners were already bound on this same audio element,
        // remove them before attaching fresh handlers.
        if (audio._timeupdateHandler) {
            audio.removeEventListener('timeupdate', audio._timeupdateHandler);
        }
        if (audio._endedHandler) {
            audio.removeEventListener('ended', audio._endedHandler);
        }
        if (audio._loadedmetadataHandler) {
            audio.removeEventListener('loadedmetadata', audio._loadedmetadataHandler);
        }
        if (audio._errorHandler) {
            audio.removeEventListener('error', audio._errorHandler);
        }
        
        // Create named functions so we can remove them later
        audio._timeupdateHandler = () => {
            this.player.progress.updateProgressBars();
            // Word highlighting is driven by CaptionOriginal rAF loop and playback fallbacks.
            this.player.playback.updatePageDisplay();

            // [NEW] BOOKMARKING: Save progress every 5 seconds
            const now = Date.now();
            if (now - this.lastSaveTime > 5000) {
                this.saveBookmark();
                this.lastSaveTime = now;
            }
        };
        
        audio._endedHandler = () => {
            this.player.navigation.handleAudioEnded().catch((error) => {
                console.error('[AudioControls] handleAudioEnded failed', {
                    chunkIndex: this.player.currentChunkIndex
                }, error);
                if (typeof this.player.captureSubsystemFailure === 'function') {
                    this.player.captureSubsystemFailure('navigation', error, { context: 'audio-ended' });
                }
            });
        };
        
        audio._loadedmetadataHandler = () => {
            this.player.progress.updateProgressBars();
        };

        audio._errorHandler = () => {
            const isCurrent = (audio === this.player.currentAudioElement);
            if (!isCurrent) {
                return;
            }

            const chunkIndex = this.player.currentChunkIndex;
            const mediaErrorCode = audio.error ? audio.error.code : null;

            if (!this.player.audioDecodeRetriedChunks.has(chunkIndex)) {
                this.player.audioDecodeRetriedChunks.add(chunkIndex);
                void this.recoverFromAudioDecodeError(audio, chunkIndex, mediaErrorCode).catch((retryError) => {
                    console.error('[AudioControls] Audio decode retry failed', { chunkIndex }, retryError);
                    this.reportAudioElementError(audio);
                });
                return;
            }

            this.reportAudioElementError(audio);
        };
        
        // Add event listeners with named functions
        audio.addEventListener('timeupdate', audio._timeupdateHandler);
        audio.addEventListener('ended', audio._endedHandler);
        audio.addEventListener('loadedmetadata', audio._loadedmetadataHandler);
        audio.addEventListener('error', audio._errorHandler);
    }

    reportAudioElementError(audio) {
        const mediaError = typeof this.player.formatMediaElementError === 'function'
            ? this.player.formatMediaElementError(audio, { label: 'audio-element-error' })
            : new Error('Audio playback error');

        console.error('[AudioControls] Current audio element error', {
            chunkIndex: this.player.currentChunkIndex,
            mediaErrorCode: audio.error?.code ?? null,
            src: audio.currentSrc || audio.src || null
        }, mediaError);

        if (typeof this.player.captureSubsystemFailure === 'function') {
            this.player.captureSubsystemFailure('playback', mediaError, {
                context: 'audio-element-error',
                chunkIndex: this.player.currentChunkIndex
            });
            return;
        }

        this.player.input.ui.showStatus(mediaError.message, 'error');
    }

    // Approved exception (2026-07-31) to this repo's "no fallback behavior:
    // throw clear errors" rule (AGENTS.md), mirroring the TTS-sanity and
    // hydration retries. A fetched chunk audio blob can pass materialization
    // (non-empty) but still fail to decode in the browser (MEDIA_ERR_DECODE)
    // — most plausibly a truncated transfer on a flaky mobile connection.
    // Re-fetches the chunk's audio fresh from its original remote URL,
    // reloads the current audio element, and resumes playback from where it
    // was. Only ever attempted once per chunk (audioDecodeRetriedChunks) —
    // a second failure falls through to the real error via the caller's catch.
    async recoverFromAudioDecodeError(audio, chunkIndex, mediaErrorCode) {
        const chunk = this.player.audioChunks?.[chunkIndex];
        if (!chunk) {
            throw new Error(`[AudioControls] No chunk data available to retry chunk ${chunkIndex}.`);
        }

        console.warn(
            `[AudioControls] Chunk ${chunkIndex} audio failed to decode (MediaError code ${mediaErrorCode}) ` +
            '— re-fetching and retrying playback once.',
            { chunkIndex, src: audio.currentSrc || audio.src || null }
        );

        const wasPlaying = !audio.paused;
        const resumeTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

        const freshAudioUrl = await this.player.localAudio.retryMaterializeChunkAudio(chunkIndex, chunk);

        if (audio !== this.player.currentAudioElement) {
            // Navigation moved on to a different chunk while the retry fetch was in flight.
            return;
        }

        // Detach the persistent error handler for the reload window so a second
        // decode failure is reported exactly once, by this method's caller.
        audio.removeEventListener('error', audio._errorHandler);
        try {
            audio.src = freshAudioUrl;
            audio.load();

            await new Promise((resolve, reject) => {
                const onReady = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    const code = audio.error ? audio.error.code : 'unknown';
                    reject(new Error(`[AudioControls] Chunk ${chunkIndex} failed to decode again after retry (MediaError code ${code}).`));
                };
                const cleanup = () => {
                    audio.removeEventListener('loadedmetadata', onReady);
                    audio.removeEventListener('canplay', onReady);
                    audio.removeEventListener('error', onError);
                };
                audio.addEventListener('loadedmetadata', onReady, { once: true });
                audio.addEventListener('canplay', onReady, { once: true });
                audio.addEventListener('error', onError, { once: true });
            });
        } finally {
            audio.addEventListener('error', audio._errorHandler);
        }

        audio.currentTime = Number.isFinite(audio.duration)
            ? Math.min(resumeTime, audio.duration)
            : resumeTime;

        if (wasPlaying) {
            await audio.play();
        }
    }

    getPageStartTime(pageIndex) {
        return this.player.getPagePlaybackStartTime(pageIndex);
    }

    resolveFullChunkPlayPageIndex() {
        const pages = this.player.pages || [];
        if (!Array.isArray(pages) || pages.length === 0) {
            return null;
        }

        let pageIndex = this.player.selectedPageIndex;
        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
            const selectedPageContainer = this.player.elements.fullChunkDisplay?.querySelector('.page-container.selected');
            if (selectedPageContainer) {
                const rawPageIndex = parseInt(selectedPageContainer.dataset.pageIndex, 10);
                const playbackAdapter = this.player.playbackAdapter;
                if (playbackAdapter?.resolvePageArrayIndex) {
                    pageIndex = playbackAdapter.resolvePageArrayIndex(rawPageIndex);
                } else if (Number.isInteger(rawPageIndex) && rawPageIndex >= 0 && rawPageIndex < pages.length) {
                    pageIndex = rawPageIndex;
                }
            }
        }

        if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
            pageIndex = 0;
        }

        return pageIndex;
    }

    static ACTION_BUTTON_FLASH_MS = 220;

    flashActionButton(button, durationMs = AudioControls.ACTION_BUTTON_FLASH_MS) {
        if (!button || button.disabled || button.hidden) {
            return;
        }

        if (button._actionButtonFlashTimeoutId) {
            window.clearTimeout(button._actionButtonFlashTimeoutId);
            button._actionButtonFlashTimeoutId = null;
        }

        button.classList.add('is-pressed');
        button._actionButtonFlashTimeoutId = window.setTimeout(() => {
            button.classList.remove('is-pressed');
            button._actionButtonFlashTimeoutId = null;
        }, durationMs);
    }

    flashHeroButton() {
        this.flashActionButton(this.player.elements.generateBtn);
    }

    flashPageNavButton(delta) {
        const button = delta < 0
            ? this.player.elements.prevPageBtn
            : this.player.elements.nextPageBtn;
        this.flashActionButton(button);
    }

    triggerPageNav(delta) {
        if (!Number.isInteger(delta) || delta === 0) {
            throw new Error('[Controls] triggerPageNav delta must be a non-zero integer.');
        }

        const button = delta < 0
            ? this.player.elements.prevPageBtn
            : this.player.elements.nextPageBtn;
        if (!button || button.disabled || button.hidden) {
            return;
        }

        this.flashPageNavButton(delta);
        this.stepNav(delta);
    }

    handleKeyboardNav(delta) {
        if (!Number.isInteger(delta) || delta === 0) {
            throw new Error('[Controls] handleKeyboardNav delta must be a non-zero integer.');
        }

        this.triggerPageNav(delta);
    }

    stepNav(delta) {
        if (!Number.isInteger(delta) || delta === 0) {
            throw new Error('[Controls] stepNav delta must be a non-zero integer.');
        }
        if (this.player.isGenerating) {
            return;
        }

        const view = this.player.activeView;
        if (view === 'fullchunk') {
            this.stepChunk(delta);
            return;
        }
        if (view === 'pageview') {
            this.stepPage(delta);
        }
    }

    stepChunk(delta) {
        if (!Number.isInteger(delta) || delta === 0) {
            throw new Error('[Controls] stepChunk delta must be a non-zero integer.');
        }
        if (this.player.activeView !== 'fullchunk') {
            return;
        }
        if (!this.player.navigation || typeof this.player.navigation.switchToChunk !== 'function') {
            throw new Error('[Controls] navigation.switchToChunk is required for FullChunk chunk navigation.');
        }

        const nextIndex = this.player.currentChunkIndex + delta;
        if (nextIndex < 0 || nextIndex >= this.player.totalChunks) {
            return;
        }

        void this.player.navigation.switchToChunk(nextIndex);
    }

    stepPage(delta) {
        if (!Number.isInteger(delta) || delta === 0) {
            throw new Error('[Controls] stepPage delta must be a non-zero integer.');
        }
        if (this.player.isGenerating) {
            return;
        }
        if (this.player.activeView !== 'pageview') {
            return;
        }

        const pages = this.player.pages;
        if (!Array.isArray(pages) || pages.length <= 1) {
            return;
        }

        const currentIndex = this.player.resolveCurrentPageNavIndex();
        if (!Number.isInteger(currentIndex)) {
            return;
        }

        const nextIndex = currentIndex + delta;
        if (nextIndex < 0 || nextIndex >= pages.length) {
            return;
        }

        this.selectPageViewPage(nextIndex);

        if (typeof this.player.syncOverlayActionState === 'function') {
            this.player.syncOverlayActionState({ mode: 'pageview' });
        }
    }

    selectPageViewPage(pageIndex) {
        const startTime = this.getPageStartTime(pageIndex);
        this.player.selectedPageIndex = pageIndex;
        this.player.selectedPageStartTime = startTime;
        this.player.selectedWordStartTime = startTime;
        this.player.currentPageIndex = pageIndex;
        this.player.pendingPageSelectionForPlay = false;

        const audioEl = this.player.currentAudioElement;
        const dataDisplay = this.player.input?.dataDisplay;
        if (!dataDisplay || typeof dataDisplay.updateTextDisplayForPage !== 'function') {
            throw new Error('[Controls] dataDisplay.updateTextDisplayForPage is required for PageView page navigation.');
        }

        const renderPromise = dataDisplay.updateTextDisplayForPage(pageIndex);
        if (audioEl) {
            audioEl.currentTime = startTime;
        }
        if (this.player.progress && typeof this.player.progress.syncProgressToSelectedPage === 'function') {
            this.player.progress.syncProgressToSelectedPage();
        }

        Promise.resolve(renderPromise).then(() => {
            if (audioEl && this.player.captioning) {
                this.player.captioning.updateWordHighlighting(startTime);
            }
            const pageViewDisplay = this.player.elements.pageViewDisplay;
            if (pageViewDisplay && audioEl && !audioEl.paused) {
                pageViewDisplay.classList.add('playing');
            } else if (pageViewDisplay && audioEl?.paused) {
                pageViewDisplay.classList.remove('playing');
            }
            if (this.player.progress && typeof this.player.progress.syncProgressToSelectedPage === 'function') {
                this.player.progress.syncProgressToSelectedPage();
            }
        });
    }

    async playSelectedPageFromFullChunk() {
        if (!this.player.currentAudioElement) {
            return;
        }

        if (this.player.activeView !== 'fullchunk') {
            throw new Error('[Controls] playSelectedPageFromFullChunk requires active fullchunk view.');
        }

        const pageIndex = this.resolveFullChunkPlayPageIndex();
        if (!Number.isInteger(pageIndex)) {
            this.player.input.ui.showStatus('Select a page to play.', 'error');
            return;
        }

        this.player.selectedPageIndex = pageIndex;
        this.player.selectedPageStartTime = this.getPageStartTime(pageIndex);
        this.player.selectedWordStartTime = this.player.selectedPageStartTime;
        this.player.pendingPageSelectionForPlay = true;
        this.player.currentPageIndex = pageIndex;

        await this.playAudio();
    }

    handlePlaybackHeroAction() {
        if (!this.player.currentAudioElement) {
            return;
        }

        if (this.player.activeView === 'pageview') {
            this.togglePlayback();
            return;
        }

        if (this.player.activeView === 'fullchunk') {
            void this.playSelectedPageFromFullChunk().catch((error) => {
                console.error('[Controls] playSelectedPageFromFullChunk failed', error);
                if (typeof this.player.showStatus === 'function') {
                    this.player.showStatus('Playback failed', 'error');
                }
            });
        }
    }

    handleSpacebarPlaybackAction() {
        if (!this.player.currentAudioElement || this.player.isGenerating) {
            return;
        }

        if (this.player.activeView === 'pageview') {
            this.flashHeroButton();
            this.togglePlayback();
            return;
        }

        if (
            this.player.activeView === 'fullchunk' &&
            this.player.currentAudioElement.paused
        ) {
            this.flashHeroButton();
            void this.playSelectedPageFromFullChunk().catch((error) => {
                console.error('[Controls] playSelectedPageFromFullChunk failed', error);
                if (typeof this.player.showStatus === 'function') {
                    this.player.showStatus('Playback failed', 'error');
                }
            });
        }
    }
    
    setupMediaSession() {
        if (!('mediaSession' in navigator)) return;

        const title = this.player.getEffectiveRequestTitle?.() || 'ArT Reader';
        const chunkIndex = this.player.currentChunkIndex ?? 0;
        const totalChunks = this.player.audioChunks?.length ?? 0;
        const artist = totalChunks > 1 ? `Chunk ${formatChunkOrdinal(chunkIndex)} of ${totalChunks}` : 'ArT Reader';

        navigator.mediaSession.metadata = new MediaMetadata({
            title,
            artist,
            album: 'ArT Reader',
        });

        navigator.mediaSession.setActionHandler('play', () => {
            this.playAudio().catch(() => {});
        });
        navigator.mediaSession.setActionHandler('pause', () => {
            this.pauseAudio();
        });
        navigator.mediaSession.setActionHandler('nexttrack', () => {
            this.player.navigation.handleAudioEnded().catch((error) => {
                console.error('[AudioControls] handleAudioEnded failed (mediaSession nexttrack)', {
                    chunkIndex: this.player.currentChunkIndex
                }, error);
                if (typeof this.player.captureSubsystemFailure === 'function') {
                    this.player.captureSubsystemFailure('navigation', error, { context: 'media-session-nexttrack' });
                }
            });
        });
        navigator.mediaSession.setActionHandler('previoustrack', null);
    }

    updateMediaSessionState(isPlaying) {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }

    async playAudio() {
        if (!this.player.currentAudioElement) {
            return;
        }

        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('play');
        }
        
        const audio = this.player.currentAudioElement;
        const pages = this.player.pages || [];
        const hasPageSelectionTarget =
            !!this.player.pendingPageSelectionForPlay &&
            Number.isInteger(this.player.selectedPageIndex) &&
            this.player.selectedPageIndex >= 0 &&
            this.player.selectedPageIndex < pages.length;

        let targetTime = audio.currentTime;
        let targetPageIndex = 0;
        if (hasPageSelectionTarget) {
            targetPageIndex = this.player.selectedPageIndex;
            targetTime = Number.isFinite(this.player.selectedPageStartTime)
                ? this.player.selectedPageStartTime
                : this.getPageStartTime(targetPageIndex);
        } else if (Number.isFinite(this.player.selectedWordStartTime)) {
            targetTime = this.player.selectedWordStartTime;
            targetPageIndex = this.player.input.dataDisplay.getCurrentPageForTime(targetTime, {
                allowSeekUndershoot: true
            });
        } else {
            targetPageIndex = this.player.input.dataDisplay.getCurrentPageForTime(targetTime, {
                allowSeekUndershoot: true
            });
        }
        if (!Number.isFinite(targetTime) || targetTime < 0) {
            targetTime = 0;
        }

        const isFullChunkMode = this.player.activeView === 'fullchunk';
        const hasRenderedTargetPage =
            this.player.renderedChunkIndex === this.player.currentChunkIndex &&
            this.player.renderedPageIndex === targetPageIndex;
        const shouldRenderTargetPage =
            pages.length > 0 &&
            Number.isInteger(targetPageIndex) &&
            targetPageIndex >= 0 &&
            targetPageIndex < pages.length &&
            (isFullChunkMode || !hasRenderedTargetPage);

        if (shouldRenderTargetPage) {
            this.player.currentPageIndex = targetPageIndex;
            await this.player.input.dataDisplay.updateTextDisplayForPage(targetPageIndex, {
                activateView: !isFullChunkMode
            });
        }

        audio.currentTime = targetTime;

        try {
            await audio.play();
            this.player.pendingPageSelectionForPlay = false;
            this.player.selectedPageIndex = null;
            this.player.selectedPageStartTime = null;
            if (typeof this.player.setActiveView === 'function') {
                this.player.setActiveView('pageview');
            }
        } catch (err) {
            if (err && err.name === 'NotAllowedError' && this.player.navigation?._deferPlayUntilVisible) {
                // Can happen when Media Session's lock-screen/OS "play" control fires
                // while the window is unfocused. Retry on refocus rather than giving up.
                this.player.navigation._deferPlayUntilVisible(audio, () => {
                    this.player.pendingPageSelectionForPlay = false;
                    this.player.selectedPageIndex = null;
                    this.player.selectedPageStartTime = null;
                    if (typeof this.player.setActiveView === 'function') {
                        this.player.setActiveView('pageview');
                    }
                    this.dimPlaybackChrome();
                    if (this.player.captioning) {
                        this.player.captioning.startHighlighting();
                    }
                    const pageViewDisplay = this.player.elements.pageViewDisplay;
                    if (pageViewDisplay) {
                        pageViewDisplay.classList.add('playing');
                    }
                    if (typeof this.player.setOverlayActionState === 'function') {
                        this.player.setOverlayActionState({
                            mode: 'pageview',
                            isPlaying: true,
                            hasAudio: this.player.computeHasAudio(),
                            isGenerating: this.player.isGenerating,
                            hasSavableState: this.player.computeHasSavableState(),
                            canSave: this.player.computeHasSavableState(),
                            canExport: this.player.computeHasCompleteLocalSession(),
                            canReset: this.player.computeCanReset()
                        });
                    }
                    this.updateMediaSessionState(true);
                });
                return;
            }
            this.player.input.ui.showStatus('Playback failed', 'error');
            if (typeof this.player.setOverlayActionState === 'function') {
                this.player.setOverlayActionState({
                    mode: this.player.activeView,
                    isPlaying: false,
                    hasAudio: this.player.computeHasAudio(),
                    isGenerating: this.player.isGenerating,
                    hasSavableState: this.player.computeHasSavableState(),
                    canSave: this.player.computeHasSavableState(),
                    canExport: this.player.computeHasCompleteLocalSession(),
                    canReset: this.player.computeCanReset()
                });
            }
            return;
        }

        try {
            this.dimPlaybackChrome();

            const speedDisplay = document.getElementById('speedDisplay');
            speedDisplay.style.display = 'block';

            if (this.player.captioning) {
                this.player.captioning.startHighlighting();
            }

            const pageViewDisplay = this.player.elements.pageViewDisplay;
            if (pageViewDisplay) {
                pageViewDisplay.classList.add('playing');
            }

            if (typeof this.player.setOverlayActionState === 'function') {
                this.player.setOverlayActionState({
                    mode: 'pageview',
                    isPlaying: true,
                    hasAudio: this.player.computeHasAudio(),
                    isGenerating: this.player.isGenerating,
                    hasSavableState: this.player.computeHasSavableState(),
                    canSave: this.player.computeHasSavableState(),
                    canExport: this.player.computeHasCompleteLocalSession(),
                    canReset: this.player.computeCanReset()
                });
            }
            this.setupMediaSession();
            this.updateMediaSessionState(true);
        } catch (error) {
            this.player.input.ui.showStatus('Playback failed', 'error');
        }
    }
    
    pauseAudio() {
        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('pause');
        }

        if (this.player.currentAudioElement) {
            this.player.currentAudioElement.pause();

            this.clearPlaybackChromeDimming();

            // Hide speed display
            const speedDisplay = document.getElementById('speedDisplay');
            speedDisplay.style.display = 'none';
            speedDisplay.classList.remove('highlighted');

            // Clear any pending timeout
            if (this.speedDisplayTimeout) {
                clearTimeout(this.speedDisplayTimeout);
                this.speedDisplayTimeout = null;
            }

            // Capture the start time of the currently highlighted word for resume
            if (this.player.captioning) {
                const currentTime = this.player.currentAudioElement.currentTime;
                const words = this.player.captioning.getCurrentPageWords();
                const currentWord = this.player.captioning.findWordAtTime(currentTime, words);
                if (currentWord) {
                    this.player.selectedWordStartTime = currentWord.start;
                    this.player.selectedPageIndex = null;
                    this.player.selectedPageStartTime = null;
                    this.player.pendingPageSelectionForPlay = false;
                }
            }

            const pageViewDisplay = this.player.elements.pageViewDisplay;
            if (pageViewDisplay) {
                pageViewDisplay.classList.remove('playing');
            }

            if (typeof this.player.setOverlayActionState === 'function') {
                this.player.setOverlayActionState({
                    mode: this.player.activeView,
                    isPlaying: false,
                    hasAudio: this.player.computeHasAudio(),
                    isGenerating: this.player.isGenerating,
                    hasSavableState: this.player.computeHasSavableState(),
                    canSave: this.player.computeHasSavableState(),
                    canExport: this.player.computeHasCompleteLocalSession(),
                    canReset: this.player.computeCanReset()
                });
            }
            this.updateMediaSessionState(false);
        }
    }
    
    togglePlayback() {
        if (!this.player.currentAudioElement) return;
        
        if (this.player.currentAudioElement.paused) {
            this.playAudio();
        } else {
            this.pauseAudio();
        }
    }
    
    seekToTime(time) {
        if (this.player.currentAudioElement) {
            this.player.currentAudioElement.currentTime = time;
            this.player.selectedWordStartTime = time;
            this.player.selectedPageIndex = null;
            this.player.selectedPageStartTime = null;
            this.player.pendingPageSelectionForPlay = false;
        }
    }
    
    setPlaybackSpeed(speed) {
        // Clamp speed between 0.80 and 1.30
        const clampedSpeed = Math.max(0.80, Math.min(1.30, speed));
        this.player.playbackSpeed = clampedSpeed;
        
        // Apply to current audio element
        if (this.player.currentAudioElement) {
            this.player.currentAudioElement.playbackRate = clampedSpeed;
        }
        
        // Update speed display
        const speedDisplay = document.getElementById('speedDisplay');
        if (speedDisplay) {
            speedDisplay.textContent = Math.round(clampedSpeed * 100) + '%';
            
            // Brighten speed display when user is adjusting
            this.highlightSpeedDisplay();
        }
    }

    highlightSpeedDisplay() {
        const speedDisplay = document.getElementById('speedDisplay');
        if (!speedDisplay) return;
        
        // Highlight the speed display
        speedDisplay.classList.add('highlighted');
        
        // Clear existing timeout
        if (this.speedDisplayTimeout) {
            clearTimeout(this.speedDisplayTimeout);
        }
        
        // Set new timeout to remove highlight after 1 second
        this.speedDisplayTimeout = setTimeout(() => {
            speedDisplay.classList.remove('highlighted');
            this.speedDisplayTimeout = null;
        }, 1000);
    }

    adjustFontSize(delta) {
        this.player.adjustReadableTextSize(delta);
    }

    // [NEW] Save bookmark to localStorage
    saveBookmark() {
        if (!this.player.sessionId) {
            this.player.raiseSubsystemFailure(
                'storage',
                new Error('Missing session identifier for bookmark generation.'),
                { chunkIndex: this.player.currentChunkIndex }
            );
        }
        if (!this.player.currentAudioElement) {
            this.player.raiseSubsystemFailure(
                'playback',
                new Error('Missing active media element for bookmark generation.'),
                { sessionId: this.player.sessionId, chunkIndex: this.player.currentChunkIndex }
            );
        }

        const state = {
            sessionId: this.player.sessionId,
            chunkIndex: this.player.currentChunkIndex,
            currentTime: this.player.currentAudioElement.currentTime,
            timestamp: Date.now()
        };

        localStorage.setItem('rocketship_bookmark', JSON.stringify(state));
    }
}
