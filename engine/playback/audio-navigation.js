// Audio Navigation Module - Chunk switching and transitions
class AudioNavigation {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Navigation] player is required.');
        }
        this.player = player;
        this.chunkTransitionPauseMinMs = 0;
        this.chunkTransitionPauseMaxMs = 0;
    }
    
    setupNavigationListeners() {
        // Add click handlers for progress segments
        /* document.addEventListener('click', (e) => {
            const segment = e.target.closest('[data-chunk-index]');
            if (segment) {
                const chunkIndex = parseInt(segment.dataset.chunkIndex);
                this.handleProgressSegmentClick(e, chunkIndex);
            }
        }); */
    }
    
    clearPendingAutoResume(reason = 'manual') {
        this.player.pendingAutoResumeChunkIndex = null;
    }

    async waitForPageViewTransitionSettled(context = 'unknown') {
        if (document.hidden) {
            return;
        }

        const maxWaitMs = 5000;
        const pending = this.player.pendingPageTransitionPromise;
        if (pending) {
            try {
                await Promise.race([
                    pending,
                    this.wait(maxWaitMs).then(() => {
                        throw new Error(`[Navigation] PageView transition promise did not settle within ${maxWaitMs}ms (${context}).`);
                    })
                ]);
            } catch (error) {
                // Display reports render failures and clears the flag; only rethrow if still wedged.
                if (this.player.captioning?.isTransitioningPage) {
                    throw error;
                }
                console.error(
                    '[Navigation] PageView transition wait failed after isTransitioningPage cleared',
                    { context },
                    error
                );
            }
        }

        if (this.player.captioning?.isTransitioningPage) {
            await new Promise((resolve, reject) => {
                let intervalId = null;
                let timeoutId = null;

                const cleanup = () => {
                    if (intervalId !== null) {
                        clearInterval(intervalId);
                        intervalId = null;
                    }
                    if (timeoutId !== null) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                };

                intervalId = setInterval(() => {
                    if (!this.player.captioning?.isTransitioningPage) {
                        cleanup();
                        resolve();
                    }
                }, 50);

                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`[Navigation] PageView transition did not settle within ${maxWaitMs}ms (${context}).`));
                }, maxWaitMs);
            });
        }
    }

    getChunkTransitionPauseMs() {
        const span = this.chunkTransitionPauseMaxMs - this.chunkTransitionPauseMinMs;
        if (span < 0) {
            throw new Error('[Navigation] chunk transition pause bounds are invalid.');
        }
        return this.chunkTransitionPauseMinMs + Math.floor(Math.random() * (span + 1));
    }

    wait(ms) {
        if (!Number.isFinite(ms) || ms < 0) {
            throw new Error('[Navigation] wait(ms) requires a non-negative finite number.');
        }
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    _deferPlayUntilVisible(audio, onStarted) {
        // NotAllowedError from autoplay policy can be triggered by loss of window/OS
        // focus even while document.hidden stays false (tab still active, window just
        // not frontmost). Relying on visibilitychange alone leaves this handler dead
        // forever in that case, since document.hidden never flips. Retry on any signal
        // that playback conditions may have changed, plus a periodic safety-net poll.
        let settled = false;
        let retryTimer = null;

        const onVisibilityChange = () => attemptResume('visibilitychange');
        const onWindowFocus = () => attemptResume('window-focus');

        const cleanup = () => {
            settled = true;
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', onWindowFocus);
            if (retryTimer) {
                clearInterval(retryTimer);
                retryTimer = null;
            }
        };

        const attemptResume = () => {
            if (settled) return;
            if (audio !== this.player.currentAudioElement) {
                cleanup();
                return;
            }
            audio.play().then(() => {
                cleanup();
                if (typeof onStarted === 'function') onStarted();
            }).catch(() => {
                // Still blocked — keep waiting for the next signal or poll tick.
            });
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', onWindowFocus);
        retryTimer = setInterval(() => attemptResume('poll'), 2000);
    }

    _onChunkPlaybackStarted() {
        this.player.pendingChunkGapMetric = null;
        this.clearPendingAutoResume('transition-complete');

        // Playback just proved it's no longer blocked, so a stale hydration/
        // playback error notice (e.g. "chunk hasn't downloaded yet") is now
        // moot — clear it rather than leaving it on screen indefinitely.
        if (typeof this.player.clearConsoleErrorNotice === 'function') {
            this.player.clearConsoleErrorNotice(['hydration', 'playback']);
        }

        if (this.player.controls?.dimPlaybackChrome) {
            this.player.controls.dimPlaybackChrome();
        }

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
    }
    
    async handleProgressSegmentClick(e, chunkIndex) {
        this.clearPendingAutoResume('segment-click');
        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('segment-click');
        }

        this.player.input.cloudrun.requireChunk(chunkIndex);

        // Remove playing class to reset to initial state styling
        const pageViewDisplay = this.player.elements.pageViewDisplay;
        if (pageViewDisplay) {
            pageViewDisplay.classList.remove('playing');
        }

        // Always pause audio first if it's playing
        if (this.player.currentAudioElement && !this.player.currentAudioElement.paused) {
            this.player.playback.pauseAudio();
        }
        
        // If clicking the current chunk, just ensure full text is shown
        if (chunkIndex === this.player.currentChunkIndex) {
            // Store current playback time to set as selected word
            const currentTime = this.player.currentAudioElement ? this.player.currentAudioElement.currentTime : 0;
            this.player.selectedWordStartTime = currentTime;
            this.player.selectedPageIndex = null;
            this.player.selectedPageStartTime = null;
            this.player.pendingPageSelectionForPlay = false;
            
            this.player.input.dataDisplay.displayFullChunk(chunkIndex);
            return;
        }
        
        // For any other chunk, switch to it
        await this.switchToChunk(chunkIndex);
    }
    
    async switchToChunk(chunkIndex) {
        this.clearPendingAutoResume('switch-chunk');
        this.player.input.cloudrun.requireChunk(chunkIndex);
        this.player.pendingChunkGapMetric = null;
        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('switch-chunk');
        }
        // Pause current audio if playing
        if (this.player.currentAudioElement && !this.player.currentAudioElement.paused) {
            this.player.playback.pauseAudio();
        }
        
        // Reset selected word time to start of chunk when switching to a new chunk
        this.player.selectedWordStartTime = 0;
        this.player.selectedPageIndex = null;
        this.player.selectedPageStartTime = null;
        this.player.pendingPageSelectionForPlay = false;
        
        await this.player.input.cloudrun.loadChunk(chunkIndex, false);

        const audio = this.player.currentAudioElement;
        if (!audio) {
            this.player.raiseSubsystemFailure(
                'navigation',
                new Error(`Chunk ${formatChunkOrdinal(chunkIndex)} loaded without a bound audio element.`),
                { chunkIndex, sessionId: this.player.sessionId }
            );
        }

        await this.player.waitForAudioPlaybackReady(audio, {
            chunkIndex,
            sessionId: this.player.sessionId
        });

        this.player.input.dataDisplay.displayFullChunk(chunkIndex);
        this.player.currentChunkIndex = chunkIndex;
        this.player.currentPageIndex = 0;

        this.player.progress.updateProgressBars();

        if (typeof this.player.setOverlayActionState === 'function') {
            this.player.setOverlayActionState({
                mode: 'fullchunk',
                isPlaying: false,
                hasAudio: this.player.computeHasAudio(),
                isGenerating: this.player.isGenerating,
                hasSavableState: this.player.computeHasSavableState(),
                canSave: this.player.computeHasSavableState(),
                canExport: this.player.computeHasCompleteLocalSession(),
                canReset: this.player.computeCanReset()
            });
        }

        return audio;
    }

    async transitionToChunkPlayback(chunkIndex) {
        if (this.player.controls?.dimPlaybackChrome) {
            this.player.controls.dimPlaybackChrome();
        }

        if (this.player.captioning) {
            this.player.captioning.stopHighlighting({ skipPauseRender: true });
        }

        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('chunk-transition');
        }

        if (this.player.captioning) {
            this.player.captioning.setTransitioningPage(false);
        }
        this.player.renderedChunkIndex = null;
        this.player.renderedPageIndex = null;

        if (typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('pageview');
        }

        const success = await this.player.input.cloudrun.loadChunk(chunkIndex, true);

        if (!success) {
            throw new Error(`[Navigation] Failed to load chunk ${chunkIndex}.`);
        }

        const nextChunk = this.player.audioChunks[chunkIndex];
        this.player.currentChunkIndex = chunkIndex;
        this.player.currentPageIndex = 0;

        if (nextChunk && nextChunk.speakingPartIndex !== undefined) {
            this.player.updateHighlightColor(nextChunk.speakingPartIndex);
        } else {
            this.player.updateHighlightColor();
        }

        const audioElement = this.player.currentAudioElement;
        if (!audioElement) {
            this.player.raiseSubsystemFailure(
                'navigation',
                new Error(`Chunk ${formatChunkOrdinal(chunkIndex)} transition loaded without a bound audio element.`),
                { chunkIndex, sessionId: this.player.sessionId }
            );
        }

        await this.player.waitForAudioPlaybackReady(audioElement, {
            chunkIndex,
            sessionId: this.player.sessionId
        });
        audioElement.currentTime = 0;

        this.player.progress.rebuildProgressBars();

        if (this.player.pages && this.player.pages.length > 0) {
            const pageDisplayUpdate = this.player.input.dataDisplay.updateTextDisplayForPage(0, {
                activateView: true
            });
            if (document.hidden) {
                pageDisplayUpdate.catch((error) => {
                    console.error('[Navigation] Background page render failed during chunk transition', {
                        chunkIndex,
                        hidden: document.hidden,
                        error
                    });
                    if (typeof this.player.captureSubsystemFailure === 'function') {
                        this.player.captureSubsystemFailure('display', error, {
                            pageIndex: 0,
                            chunkIndex,
                            context: 'page-render-background'
                        });
                    }
                });
            } else {
                await pageDisplayUpdate;
            }
        }

        if (typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('pageview');
        }

        const transitionPauseMs = this.getChunkTransitionPauseMs();
        if (transitionPauseMs > 0) {
            await this.wait(transitionPauseMs);
        }
        try {
            await this.player.currentAudioElement.play();
            if (this.player.controls?.setupMediaSession) {
                this.player.controls.setupMediaSession();
            }
            this._onChunkPlaybackStarted();
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                // Browser blocked play() — tab hidden or screen locked. Defer until visible.
                this._deferPlayUntilVisible(
                    this.player.currentAudioElement,
                    () => this._onChunkPlaybackStarted()
                );
            } else {
                // AbortError or any other error: src/load race or fatal failure — do not defer.
                console.error('[Navigation] play() failed during chunk transition', {
                    chunkIndex,
                    hidden: document.hidden,
                    errorName: err?.name,
                    errorMessage: err?.message,
                    error: err
                });
                this.player.isTransitioningChunks = false;
                if (typeof this.player.captureSubsystemFailure === 'function') {
                    this.player.captureSubsystemFailure('playback', err, {
                        chunkIndex,
                        context: 'chunk-transition-play'
                    });
                } else {
                    this.player.input.ui.showStatus('Playback could not resume automatically', 'error');
                }
                return;
            }
        }

    }

    enterWaitingForNextChunk(chunkIndex) {
        this.player.pendingAutoResumeChunkIndex = chunkIndex;
        if (this.player.controls?.dimPlaybackChrome) {
            this.player.controls.dimPlaybackChrome();
        }
        this.player.input.cloudrun.showStatus('Loading...', 'loading');

        if (typeof this.player.setOverlayActionState === 'function') {
            this.player.setOverlayActionState({
                mode: 'pageview',
                isPlaying: false,
                hasAudio: this.player.computeHasAudio(),
                isGenerating: this.player.isGenerating,
                hasSavableState: this.player.computeHasSavableState(),
                canSave: this.player.computeHasSavableState(),
                canExport: this.player.computeHasCompleteLocalSession(),
                canReset: this.player.computeCanReset()
            });
        }
    }

    async resumePendingChunkTransitionIfReady(chunkIndex) {
        if (this.player.pendingAutoResumeChunkIndex !== chunkIndex) {
            return false;
        }

        if (!this.player.input.cloudrun.isChunkReadyForPlayback(chunkIndex)) {
            return false;
        }

        if (this.player.isTransitioningChunks) {
            return false;
        }

        this.player.isTransitioningChunks = true;

        try {
            await this.transitionToChunkPlayback(chunkIndex);
            return true;
        } finally {
            this.player.isTransitioningChunks = false;
        }
    }
    
    async handleAudioEnded() {
        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('audio-ended');
        }
        if (this.player.isTransitioningChunks) {
            console.warn('[Navigation] handleAudioEnded skipped — chunk transition already in flight', {
                currentChunkIndex: this.player.currentChunkIndex
            });
            return;
        }

        const nextChunkIndex = this.player.currentChunkIndex + 1;
        const hasNextChunk = this.player.audioChunks && nextChunkIndex < this.player.audioChunks.length;

        await this.waitForPageViewTransitionSettled('handleAudioEnded');

        this.player.isTransitioningChunks = true;

        try {
            if (hasNextChunk) {
                this.player.pendingChunkGapMetric = {
                    fromChunkIndex: this.player.currentChunkIndex,
                    toChunkIndex: nextChunkIndex,
                    endedAt: performance.now()
                };
                if (this.player.input.cloudrun.isChunkReadyForPlayback(nextChunkIndex)) {
                    await this.transitionToChunkPlayback(nextChunkIndex);
                } else if (this.player.input.cloudrun.isPlaybackAwaitingChunk(nextChunkIndex)) {
                    this.enterWaitingForNextChunk(nextChunkIndex);
                } else {
                    await this.recoverStalledChunkHydration(nextChunkIndex);
                }
            } else {
                this.player.pendingChunkGapMetric = null;
                await this.handlePlaybackComplete();
            }
        } finally {
            this.player.isTransitioningChunks = false;
        }
    }

    // Approved exception (2026-07-31) to this repo's "no fallback behavior:
    // throw clear errors" rule (AGENTS.md), mirroring the backend's TTS-sanity
    // retry. Reached when chunk data has already been delivered by the stream
    // but the chunk is neither hydrated nor actively hydrating — i.e. a prior
    // background hydration attempt silently failed (network blip, stale
    // signed URL) and nothing retried it. Retries hydration once, visibly,
    // before giving up with the real underlying error.
    async recoverStalledChunkHydration(chunkIndex) {
        const cloudrun = this.player.input.cloudrun;
        const coordinator = this.player.chunkLoadCoordinator;
        const diagnosticState = {
            hidden: document.hidden,
            chunkIndex,
            audioChunksLength: this.player.audioChunks?.length ?? null,
            hasChunk: cloudrun?.hasChunk(chunkIndex) ?? null,
            streamJobStarted: cloudrun?.streamJobStarted ?? null,
            streamTotalChunks: cloudrun?.streamTotalChunks ?? null,
            streamComplete: cloudrun?.streamComplete ?? null,
            streamTerminalError: cloudrun?.streamTerminalError?.message ?? null,
            hasDeliveredChunk: coordinator?.hasDeliveredChunk(chunkIndex) ?? null,
            isChunkHydrated: coordinator?.isChunkHydrated(chunkIndex) ?? null,
            isChunkHydrationInFlight: coordinator?.isChunkHydrationInFlight(chunkIndex) ?? null,
            priorHydrationError: coordinator?.getHydrationError?.(chunkIndex)?.message ?? null
        };

        if (!cloudrun?.hasChunk(chunkIndex) || !coordinator || typeof coordinator.retryChunkHydration !== 'function') {
            this.player.pendingChunkGapMetric = null;
            console.error('[Navigation] Chunk state unresolvable and not retryable — dumping state', diagnosticState);
            throw new Error('[Navigation] Failed to resolve next chunk state.');
        }

        console.warn(
            `[Navigation] Chunk ${chunkIndex} was delivered but not ready or awaiting hydration ` +
            '(prior hydration attempt likely failed silently) — retrying hydration once.',
            diagnosticState
        );

        const retrySucceeded = await coordinator.retryChunkHydration(chunkIndex);

        if (retrySucceeded && cloudrun.isChunkReadyForPlayback(chunkIndex)) {
            await this.transitionToChunkPlayback(chunkIndex);
            return;
        }

        this.player.pendingChunkGapMetric = null;
        const hydrationError = coordinator.getHydrationError(chunkIndex);
        throw new Error(
            hydrationError
                ? `[Navigation] Chunk ${chunkIndex} failed to hydrate after retry: ${hydrationError.message || hydrationError}`
                : `[Navigation] Chunk ${chunkIndex} failed to resolve after a hydration retry.`
        );
    }

    async handlePlaybackComplete() {
        this.clearPendingAutoResume('playback-complete');
        this.player.pendingChunkGapMetric = null;
        if (this.player.playback && typeof this.player.playback.resetPageTurnQueue === 'function') {
            this.player.playback.resetPageTurnQueue('playback-complete');
        }
        // Un-dim controls on completion
        if (this.player.controls?.clearPlaybackChromeDimming) {
            this.player.controls.clearPlaybackChromeDimming();
        }

        // Keep background dimming active during slideshow cycling
        // Dimming remains at 85% throughout the entire slideshow experience
        
        // Rewind to the start so Play from FullChunk can start chunk 0 again.
        this.player.selectedWordStartTime = 0;
        this.player.selectedPageIndex = 0;
        this.player.selectedPageStartTime = 0;
        this.player.pendingPageSelectionForPlay = true;
        if (this.player.currentAudioElement) {
            try {
                this.player.currentAudioElement.currentTime = 0;
            } catch (error) {}
        }
        
        // Load the first chunk (chunk 0) to cycle back to beginning, showing full text
        await this.waitForPageViewTransitionSettled('handlePlaybackComplete-before-loadChunk0');
        const success = await this.player.input.cloudrun.loadChunk(0, false);
        
        if (success) {
            // Update current chunk index to first chunk
            this.player.currentChunkIndex = 0;
            this.player.currentPageIndex = 0;
            
            // Update progress bars to show we're back at the beginning
            this.player.progress.rebuildProgressBars();
            
            // Remove playing class to ensure proper text alignment
            const pageViewDisplay = this.player.elements.pageViewDisplay;
            if (pageViewDisplay) {
                pageViewDisplay.classList.remove('playing');
            }
            
            this.player.input.dataDisplay.displayFullChunk(0);

            if (typeof this.player.setOverlayActionState === 'function') {
                this.player.setOverlayActionState({
                    mode: 'fullchunk',
                    isPlaying: false,
                    hasAudio: this.player.computeHasAudio(),
                    isGenerating: this.player.isGenerating,
                    hasSavableState: this.player.computeHasSavableState(),
                    canSave: this.player.computeHasSavableState(),
                    canExport: this.player.computeHasCompleteLocalSession(),
                    canReset: this.player.computeCanReset()
                });
            }
        }
    }
}
