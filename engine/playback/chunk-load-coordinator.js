// Single source of truth for how a chunk is numbered everywhere it is shown,
// developer- and user-facing alike. Chunks are labelled by their 0-based
// chunkIndex, matching the debug logs — so the first chunk is "Chunk 0".
// Call sites supply their own "Chunk"/"chunk" wording.
function formatChunkOrdinal(index) {
    return `${index}`;
}

class ChunkLoadCoordinator {
    constructor(player) {
        if (!player) {
            throw new Error('[ChunkLoadCoordinator] player is required.');
        }

        this.player = player;
        this._resetVersion = 0;
        this.reset('init');
    }

    reset(reason = 'manual') {
        this._resetVersion += 1;
        this._releaseAllHydratedEntries();
        this.deliveredChunkIndexes = new Set();
        this.hydrationInFlight = new Set();
        this.hydratedChunkEntries = new Map();
        this.hydrationErrors = new Map();
        this.hydrationQueue = [];
        this.isDrainingQueue = false;
    }

    normalizeChunkIndex(chunkIndex) {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
            throw new Error(`[ChunkLoadCoordinator] chunkIndex must be a non-negative integer. Received: ${chunkIndex}`);
        }
        return chunkIndex;
    }

    getChunkOrThrow(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        const chunk = this.player.audioChunks?.[normalizedChunkIndex];
        if (!chunk || typeof chunk !== 'object') {
            throw new Error(`[ChunkLoadCoordinator] Chunk ${formatChunkOrdinal(normalizedChunkIndex)} is unavailable.`);
        }
        if (typeof chunk.audioUrl !== 'string' || !chunk.audioUrl.trim()) {
            throw new Error(`[ChunkLoadCoordinator] Chunk ${formatChunkOrdinal(normalizedChunkIndex)} audioUrl is missing.`);
        }
        return chunk;
    }

    async initializeFirstChunk(chunkIndex = 0) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        const chunk = this.getChunkOrThrow(normalizedChunkIndex);
        this.deliveredChunkIndexes.add(normalizedChunkIndex);

        this.player.updateHighlightColor(chunk.speakingPartIndex);
        this.player.input.dataCore.loadPagesData(chunk.pages, {
            chunkIndex: normalizedChunkIndex,
            source: 'initializeFirstChunk'
        });

        const stableAudioUrl = await this.player.input.dataCore.resolveStableAudioUrl(chunk);
        await this.player.input.dataCore.initializeAudio(stableAudioUrl);
        await this.player.waitForAudioPlaybackReady(this.player.currentAudioElement, {
            chunkIndex: normalizedChunkIndex,
            sessionId: this.player.sessionId
        });

        this.player.currentChunkIndex = normalizedChunkIndex;
        this.player.currentPageIndex = 0;

        const autoPlay = this.player.loading?.isAutoPlayEnabled?.() === true;

        if (autoPlay) {
            // Mirrors the reset _displayFullChunkInternal normally does, since
            // that call is skipped here — playAudio() needs these cleared to
            // know page 0 hasn't been rendered into PageView yet.
            this.player.pendingPageSelectionForPlay = false;
            this.player.renderedChunkIndex = null;
            this.player.renderedPageIndex = null;
        } else {
            this.player.input.dataDisplay.displayFullChunk(normalizedChunkIndex);
        }

        this.player.playback.progress.rebuildProgressBars();

        if (this.player.captioning?.updateHighlightingStates) {
            this.player.captioning.updateHighlightingStates([], [], [], null);
        }

        if (autoPlay) {
            if (this.player.loading?.hideLoadingInterface) {
                this.player.loading.hideLoadingInterface({ skipViewTransition: true });
            }
            if (this.player.controls && typeof this.player.controls.playAudio === 'function') {
                await this.player.controls.playAudio();
            }
        } else {
            this.player.input.dataDisplay.showPlaybackInterface();
            if (this.player.loading?.hideLoadingInterface) {
                this.player.loading.hideLoadingInterface();
            }
        }

        if (typeof this.player.syncOverlayActionState === 'function') {
            this.player.syncOverlayActionState({
                mode: this.player.activeView,
                isPlaying: this.player.getIsPlaying(),
                hasAudio: true,
                isGenerating: this.player.isGenerating,
                canSave: this.player.computeHasSavableState(),
                canExport: this.player.computeHasCompleteLocalSession()
            });
        }
    }

    markChunkDelivered(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        if (normalizedChunkIndex === 0) {
            throw new Error('[ChunkLoadCoordinator] Chunk 0 must be initialized via initializeFirstChunk().');
        }

        this.getChunkOrThrow(normalizedChunkIndex);
        this.deliveredChunkIndexes.add(normalizedChunkIndex);
        this.hydrationErrors.delete(normalizedChunkIndex);

        if (!this.hydratedChunkEntries.has(normalizedChunkIndex) && !this.hydrationQueue.includes(normalizedChunkIndex)) {
            this.hydrationQueue.push(normalizedChunkIndex);
        }

        void this._drainHydrationQueue(this._resetVersion);
    }

    notifyHydrationComplete(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        const navigation = this.player.navigation;
        if (
            navigation &&
            typeof navigation.resumePendingChunkTransitionIfReady === 'function'
        ) {
            void navigation.resumePendingChunkTransitionIfReady(normalizedChunkIndex).catch((error) => {
                this.player.captureSubsystemFailure('hydration', error, {
                    chunkIndex: normalizedChunkIndex,
                    sessionId: this.player.sessionId
                });
            });
        }
    }

    notifyHydrationFailed(chunkIndex, diagnostic) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        if (this.player.pendingAutoResumeChunkIndex === normalizedChunkIndex && diagnostic) {
            this.player.lastDiagnostic = diagnostic;
        }
    }

    hasDeliveredChunk(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        return this.deliveredChunkIndexes.has(normalizedChunkIndex);
    }

    isChunkHydrated(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        return this.hydratedChunkEntries.has(normalizedChunkIndex);
    }

    isChunkHydrationInFlight(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        return this.hydrationInFlight.has(normalizedChunkIndex)
            || this.hydrationQueue.includes(normalizedChunkIndex);
    }

    getHydrationError(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        return this.hydrationErrors.get(normalizedChunkIndex) || null;
    }

    // Approved exception (2026-07-31) to this repo's "no fallback behavior:
    // throw clear errors" rule (AGENTS.md). Chunk data can arrive from the
    // stream (deliveredChunkIndexes) while its background hydration attempt
    // silently fails (network blip, stale signed URL) and nothing retries it,
    // leaving handleAudioEnded() stuck between "ready" and "awaiting". This
    // re-attempts hydration once, directly (bypassing the queue), for a
    // chunk navigation is actively blocked on. Caller is responsible for
    // logging the retry visibly before calling this.
    async retryChunkHydration(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        const expectedVersion = this._resetVersion;

        if (this.hydratedChunkEntries.has(normalizedChunkIndex)) {
            return true;
        }
        if (this.hydrationInFlight.has(normalizedChunkIndex)) {
            return false;
        }

        try {
            await this._hydrateChunk(normalizedChunkIndex, expectedVersion);
            return this.hydratedChunkEntries.has(normalizedChunkIndex);
        } catch (error) {
            const diagnostic = this.player.captureSubsystemFailure('hydration', error, {
                chunkIndex: normalizedChunkIndex,
                sessionId: this.player.sessionId,
                context: 'navigation-retry'
            });
            this.hydrationErrors.set(normalizedChunkIndex, diagnostic);
            return false;
        }
    }

    consumeHydratedChunk(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        if (!this.deliveredChunkIndexes.has(normalizedChunkIndex)) {
            throw new Error(`[ChunkLoadCoordinator] Chunk ${formatChunkOrdinal(normalizedChunkIndex)} was requested before delivery.`);
        }

        const hydrationError = this.hydrationErrors.get(normalizedChunkIndex);
        if (hydrationError) {
            throw hydrationError;
        }

        const entry = this.hydratedChunkEntries.get(normalizedChunkIndex);
        if (!entry?.audio) {
            throw new Error(`[ChunkLoadCoordinator] Chunk ${formatChunkOrdinal(normalizedChunkIndex)} was delivered but is not hydrated.`);
        }
        return { audio: entry.audio, audioUrl: entry.audioUrl };
    }

    clearHydratedEntry(chunkIndex) {
        const normalizedChunkIndex = this.normalizeChunkIndex(chunkIndex);
        this.hydratedChunkEntries.delete(normalizedChunkIndex);
    }

    _releaseAllHydratedEntries() {
        if (!(this.hydratedChunkEntries instanceof Map)) {
            return;
        }

        for (const entry of this.hydratedChunkEntries.values()) {
            this._releaseHydratedEntry(entry);
        }
    }

    _releaseHydratedEntry(entry) {
        const audio = entry?.audio;
        if (!audio || audio === this.player.currentAudioElement) {
            return;
        }

        try { audio.pause(); } catch (error) {}
        try {
            audio.src = '';
            audio.load();
        } catch (error) {}
    }

    async _drainHydrationQueue(expectedVersion) {
        if (this.isDrainingQueue) {
            return;
        }

        this.isDrainingQueue = true;
        try {
            while (this.hydrationQueue.length > 0) {
                if (expectedVersion !== this._resetVersion) {
                    return;
                }

                const chunkIndex = this.hydrationQueue.shift();
                if (!Number.isInteger(chunkIndex)) {
                    throw new Error('[ChunkLoadCoordinator] Hydration queue produced an invalid chunk index.');
                }
                if (this.hydratedChunkEntries.has(chunkIndex) || this.hydrationInFlight.has(chunkIndex)) {
                    continue;
                }

                try {
                    await this._hydrateChunk(chunkIndex, expectedVersion);
                } catch (error) {
                    const diagnostic = this.player.captureSubsystemFailure('hydration', error, {
                        chunkIndex,
                        sessionId: this.player.sessionId
                    });
                    this.hydrationErrors.set(chunkIndex, diagnostic);
                    this.notifyHydrationFailed(chunkIndex, diagnostic);
                }
            }
        } finally {
            this.isDrainingQueue = false;
        }
    }

    async _hydrateChunk(chunkIndex, expectedVersion) {
        this.getChunkOrThrow(chunkIndex);
        this.hydrationInFlight.add(chunkIndex);

        try {
            const chunk = this.player.audioChunks[chunkIndex];
            const audioUrl = await this.player.input.dataCore.resolveStableAudioUrl(chunk);
            const audio = await this._createHydratedAudioElement(audioUrl);

            if (expectedVersion !== this._resetVersion) {
                this._releaseHydratedEntry({ audio });
                return;
            }

            const existingEntry = this.hydratedChunkEntries.get(chunkIndex);
            if (existingEntry) {
                this._releaseHydratedEntry(existingEntry);
            }

            this.hydratedChunkEntries.set(chunkIndex, {
                chunkIndex,
                audioUrl,
                audio,
                hydratedAt: Date.now()
            });
            this.hydrationErrors.delete(chunkIndex);
            this.notifyHydrationComplete(chunkIndex);
        } finally {
            this.hydrationInFlight.delete(chunkIndex);
        }
    }

    shouldSkipHydratedAudioReadinessWait(audioUrl) {
        if (typeof audioUrl !== 'string' || !audioUrl.trim()) {
            return false;
        }

        // Chunk audio is materialized locally before hydration. Background tabs defer
        // media readiness events indefinitely, which would block later chunk loading.
        if (audioUrl.trim().startsWith('blob:')) {
            return true;
        }

        return typeof document !== 'undefined' && document.hidden === true;
    }

    bindHydratedAudioSource(audio, audioUrl) {
        audio.src = audioUrl;
        try {
            audio.load();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`[ChunkLoadCoordinator] Failed to bind hydrated audio source: ${message}`);
        }
    }

    async _createHydratedAudioElement(audioUrl) {
        if (typeof audioUrl !== 'string' || !audioUrl.trim()) {
            throw new Error('[ChunkLoadCoordinator] audioUrl is required for hydration.');
        }

        const audio = new Audio();
        audio.crossOrigin = 'anonymous';
        audio.preload = 'auto';

        if (this.shouldSkipHydratedAudioReadinessWait(audioUrl)) {
            this.bindHydratedAudioSource(audio, audioUrl);
            return audio;
        }

        await new Promise((resolve, reject) => {
            const onReady = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                const mediaErrorCode = audio.error ? audio.error.code : 'unknown';
                reject(new Error(
                    `[ChunkLoadCoordinator] Hydrated audio failed before playback readiness for ${audioUrl} (MediaError code ${mediaErrorCode}).`
                ));
            };

            const cleanup = () => {
                audio.removeEventListener('loadedmetadata', onReady);
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('error', onError);
            };

            audio.addEventListener('loadedmetadata', onReady, { once: true });
            audio.addEventListener('canplay', onReady, { once: true });
            audio.addEventListener('error', onError, { once: true });
            this.bindHydratedAudioSource(audio, audioUrl);
        });

        return audio;
    }
}
