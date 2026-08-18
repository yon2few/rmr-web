// Audio Playback Module - Main coordinator for playback functionality
class AudioSystemPlayback {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Playback] player is required.');
        }
        this.player = player;
        // Defer controls initialization to avoid reference error
        this.controls = null;
        this.progress = new AudioProgress(player);
        this.navigation = new AudioNavigation(player);
        this.pendingPageTarget = null;
    }

    initialize() {
        // Initialize controls after AudioControls class is available
        this.controls = new AudioControls(this.player);
        this.controls.setupEventListeners();
        this.navigation.setupNavigationListeners();
    }
    
    setupEventListeners() {
        // This method is called by the main audio system
        // Individual event listeners are set up in initialize()
    }
    
    setupAudioEventListeners() {
        this.controls.setupAudioEventListeners();
    }
    
    // Delegate methods to appropriate modules
    async playAudio() {
        return this.controls.playAudio();
    }
    
    pauseAudio() {
        this.controls.pauseAudio();
    }
    
    togglePlayback() {
        this.controls.togglePlayback();
    }

    handlePlaybackHeroAction() {
        this.controls.handlePlaybackHeroAction();
    }
    
    seekToTime(time) {
        this.resetPageTurnQueue('seek');
        this.controls.seekToTime(time);
    }
    
    updatePageDisplay() {
        if (!this.player.currentAudioElement || !this.player.pages || this.player.pages.length <= 1) {
            return;
        }

        if (this.player.activeView !== 'pageview') {
            return;
        }

        // Don't update page display if in pause state
        if (this.player.captioning && this.player.captioning.isPaused) {
            return;
        }

        const currentTime = this.player.currentAudioElement.currentTime;
        const targetPageIndex = this.player.input.dataDisplay.getCurrentPageForTime(currentTime);
        if (!Number.isInteger(targetPageIndex)) return;

        // Capture the latest target page for this audio time, even while a transition is running.
        if (this.pendingPageTarget !== targetPageIndex) {
            this.pendingPageTarget = targetPageIndex;
        }

        this.renderPendingPageTarget('timeupdate');
    }

    renderPendingPageTarget(cause = 'unknown') {
        if (!this.player.pages || this.player.pages.length <= 1) return;
        if (!Number.isInteger(this.pendingPageTarget)) return;
        if (this.player.captioning && this.player.captioning.isTransitioningPage) return;
        if (this.player.activeView !== 'pageview') return;

        const pageCount = this.player.pages.length;
        const renderedChunkIndex = Number.isInteger(this.player.renderedChunkIndex)
            ? this.player.renderedChunkIndex
            : null;
        const renderedPageIndex = Number.isInteger(this.player.renderedPageIndex)
            ? this.player.renderedPageIndex
            : null;
        const target = Math.max(0, Math.min(pageCount - 1, this.pendingPageTarget));

        if (renderedChunkIndex === this.player.currentChunkIndex && renderedPageIndex === target) {
            this.player.currentPageIndex = target;
            this.pendingPageTarget = null;
            return;
        }

        this.pendingPageTarget = null;
        if (!this.player.captioning) {
            throw new Error('[Playback] captioning is required for PageView transitions.');
        }
        // Display owns isTransitioningPage + pendingPageTransitionPromise for the render.
        this.player.currentPageIndex = target;
        this.player.input.dataDisplay.updateTextDisplayForPage(target);
    }

    onPageRenderComplete(renderedPageIndex) {
        if (!Number.isInteger(this.pendingPageTarget)) {
            return;
        }

        if (renderedPageIndex === this.pendingPageTarget) {
            this.pendingPageTarget = null;
            return;
        }

        this.renderPendingPageTarget('render-complete');
    }

    resetPageTurnQueue(reason = 'manual') {
        this.pendingPageTarget = null;
    }
    
}
