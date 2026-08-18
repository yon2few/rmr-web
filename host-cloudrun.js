// Host chunk query/load for engine navigation. Methods match
// host/audio-input-cloudrun.js in the shared engine repo.

function formatChunkOrdinal(index) {
    return `${index}`;
}

class HostInputCloudRun {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[HostCloudRun] player is required.');
        }
        this.player = player;
    }

    showStatus(message, type) {
        if (typeof this.player.showStatus === 'function') {
            this.player.showStatus(message, type);
        }
    }

    getChunkOrThrow(chunkIndex) {
        if (!this.hasChunk(chunkIndex)) {
            throw new Error(`[CloudRun] Chunk ${formatChunkOrdinal(chunkIndex)} is unavailable.`);
        }
        return this.player.audioChunks[chunkIndex];
    }

    requireChunk(chunkIndex) {
        return this.getChunkOrThrow(chunkIndex);
    }

    hasChunk(chunkIndex) {
        return Array.isArray(this.player.audioChunks) &&
            Number.isInteger(chunkIndex) &&
            chunkIndex >= 0 &&
            chunkIndex < this.player.audioChunks.length &&
            !!this.player.audioChunks[chunkIndex];
    }

    isChunkAvailable(chunkIndex) {
        return this.hasChunk(chunkIndex);
    }

    isChunkReadyForPlayback(chunkIndex) {
        if (!this.hasChunk(chunkIndex)) {
            return false;
        }
        if (chunkIndex === 0) {
            return true;
        }
        const coordinator = this.player.chunkLoadCoordinator;
        if (!coordinator) {
            throw new Error('[CloudRun] Chunk load coordinator is required to resolve playback readiness.');
        }
        return coordinator.isChunkHydrated(chunkIndex);
    }

    isStreamAwaitingChunk(chunkIndex) {
        if (!this.player.streamJobStarted) {
            return false;
        }
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
            return false;
        }
        if (!Number.isInteger(this.player.streamTotalChunks) || chunkIndex >= this.player.streamTotalChunks) {
            return false;
        }
        return !this.hasChunk(chunkIndex);
    }

    isPlaybackAwaitingChunk(chunkIndex) {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
            return false;
        }
        if (this.isChunkReadyForPlayback(chunkIndex)) {
            return false;
        }
        const coordinator = this.player.chunkLoadCoordinator;
        if (!coordinator) {
            throw new Error('[CloudRun] Chunk load coordinator is required to resolve playback waiting state.');
        }
        if (coordinator.hasDeliveredChunk(chunkIndex) && coordinator.isChunkHydrationInFlight(chunkIndex)) {
            return true;
        }
        return this.isStreamAwaitingChunk(chunkIndex);
    }

    canNavigateToChunk(chunkIndex) {
        return this.hasChunk(chunkIndex);
    }

    async loadChunk(chunkIndex, showFirstPageOnly) {
        const targetChunk = this.getChunkOrThrow(chunkIndex);
        const previousChunkIndex = this.player.currentChunkIndex;
        const isChunkChange = chunkIndex !== previousChunkIndex;

        if (this.player.captioning && this.player.captioning.isTransitioningPage) {
            throw new Error(`[CloudRun] Cannot load chunk ${formatChunkOrdinal(chunkIndex)} while PageView transition is in flight.`);
        }

        this.player.updateHighlightColor(targetChunk.speakingPartIndex);
        this.player.input.dataCore.loadPagesData(targetChunk.pages, {
            chunkIndex,
            source: 'loadChunk'
        });

        let adopted = false;
        if (chunkIndex > 0 && this.player.chunkLoadCoordinator.isChunkHydrated(chunkIndex)) {
            const reused = this.player.chunkLoadCoordinator.consumeHydratedChunk(chunkIndex);
            adopted = await this.player.input.dataCore.adoptPreloadedAudioElement(reused, targetChunk.audioUrl);
            if (!adopted) {
                throw new Error(`[CloudRun] Failed to adopt hydrated audio for chunk ${formatChunkOrdinal(chunkIndex)}.`);
            }
            this.player.chunkLoadCoordinator.clearHydratedEntry(chunkIndex);
        }

        if (!adopted) {
            const targetChunkAudioUrl = await this.player.input.dataCore.resolveStableAudioUrl(targetChunk);
            await this.player.input.dataCore.initializeAudio(targetChunkAudioUrl);
        }

        this.player.currentChunkIndex = chunkIndex;
        if (isChunkChange || showFirstPageOnly) {
            this.player.currentPageIndex = 0;
        }

        if (
            !Number.isInteger(this.player.currentPageIndex) ||
            this.player.currentPageIndex < 0 ||
            this.player.currentPageIndex >= targetChunk.pages.length
        ) {
            throw new Error(
                `[CloudRun] currentPageIndex ${this.player.currentPageIndex} is out of range for chunk ${formatChunkOrdinal(chunkIndex)} (${targetChunk.pages.length} pages).`
            );
        }

        this.player.playback.progress.rebuildProgressBars();
        if (isChunkChange && chunkIndex > 0 && typeof window.advanceSlideForAudioPart === 'function') {
            window.advanceSlideForAudioPart();
        }
        return true;
    }
}

window.ArtReaderHostCloudRun = { HostInputCloudRun };
