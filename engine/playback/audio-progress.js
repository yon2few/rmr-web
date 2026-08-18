// Audio Progress Module - Minimal visual progress bars only
class AudioProgress {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[Progress] player is required.');
        }
        this.player = player;
        this.segmentEntries = [];
        this.progressContainer = null;
        this.lastLoggedStaleAt = 0;
        this.lastRenderedChunkIndex = null;
        this.lastRenderedProgress = null;
        this.lastRenderedAnchorTime = null;
    }

    clearSegmentCache() {
        this.segmentEntries = [];
        this.progressContainer = null;
        this.lastRenderedChunkIndex = null;
        this.lastRenderedProgress = null;
        this.lastRenderedAnchorTime = null;
    }

    isChunkAvailable(index) {
        if (!this.player.input?.cloudrun?.isChunkAvailable) {
            return false;
        }
        return this.player.input.cloudrun.isChunkAvailable(index);
    }

    getChunkAvailabilityState(index) {
        return this.isChunkAvailable(index) ? 'available' : 'pending';
    }

    applySegmentAvailability(entry, index) {
        const segment = entry?.segment;
        if (!segment) return;

        const availabilityState = this.getChunkAvailabilityState(index);
        const isAvailable = availabilityState === 'available';
        segment.dataset.availability = availabilityState;
        segment.classList.toggle('is-available', isAvailable);
        segment.classList.toggle('is-disabled', !isAvailable);
        segment.setAttribute('aria-disabled', isAvailable ? 'false' : 'true');
        segment.tabIndex = this.player.activeView === 'input'
            ? -1
            : (isAvailable ? 0 : -1);
        segment.style.pointerEvents = isAvailable ? '' : 'none';
    }

    syncSegmentAvailability() {
        for (let i = 0; i < this.segmentEntries.length; i++) {
            const entry = this.segmentEntries[i];
            this.applySegmentAvailability(entry, i);
        }
    }

    hasValidCache(expectedTotal) {
        if (!Number.isInteger(expectedTotal) || expectedTotal <= 0) return false;
        if (this.segmentEntries.length !== expectedTotal) return false;
        return this.segmentEntries.every((entry) =>
            entry &&
            entry.segment &&
            entry.segmentFill &&
            entry.segment.isConnected &&
            entry.segmentFill.isConnected
        );
    }

    recacheFromDom(expectedTotal) {
        const container = document.getElementById('progressBar');
        if (!container) return false;

        const segments = Array.from(container.querySelectorAll('.progress-segment'));
        if (segments.length !== expectedTotal) return false;

        const recached = segments.map((segment) => ({
            segment,
            segmentFill: segment.querySelector('.progress-segment-fill'),
        }));

        if (!recached.every((entry) => entry.segmentFill)) return false;

        this.segmentEntries = recached;
        this.progressContainer = container;
        this.lastRenderedChunkIndex = null;
        this.lastRenderedProgress = null;
        this.lastRenderedAnchorTime = null;
        return true;
    }

    ensureSegmentCache() {
        const expectedTotal = this.player.totalChunks;
        if (!Number.isInteger(expectedTotal) || expectedTotal <= 0) return false;

        if (this.hasValidCache(expectedTotal)) return true;
        if (this.recacheFromDom(expectedTotal)) return true;

        this.rebuildProgressBars(true);
        return this.hasValidCache(expectedTotal) || this.recacheFromDom(expectedTotal);
    }

    getSegmentEntryAtClientX(clientX) {
        if (!Number.isFinite(clientX)) {
            return null;
        }

        let closestEntry = null;
        let closestDistance = Infinity;

        for (let i = 0; i < this.segmentEntries.length; i++) {
            const entry = this.segmentEntries[i];
            const segment = entry?.segment;
            if (!segment?.isConnected) {
                continue;
            }

            const rect = segment.getBoundingClientRect();
            const left = rect.left;
            const right = rect.right;

            if (clientX >= left && clientX <= right) {
                return entry;
            }

            const distance = clientX < left ? left - clientX : clientX - right;
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEntry = entry;
            }
        }

        return closestEntry;
    }

    handleProgressContainerClick(event) {
        const explicitSegment = event.target.closest?.('.progress-segment');
        const entry = explicitSegment
            ? this.segmentEntries.find((candidate) => candidate.segment === explicitSegment) || null
            : this.getSegmentEntryAtClientX(event.clientX);

        const segment = entry?.segment;
        if (!segment) {
            return;
        }

        if (segment.getAttribute('aria-disabled') === 'true') {
            return;
        }

        const chunkIndex = Number.parseInt(segment.dataset.chunkIndex, 10);
        if (!Number.isInteger(chunkIndex)) {
            throw new Error('[Progress] Progress segment is missing a valid chunk index.');
        }

        Promise.resolve(this.player.navigation.handleProgressSegmentClick(event, chunkIndex)).catch((error) => {
            if (this.player.input?.ui?.showStatus) {
                this.player.input.ui.showStatus(error.message || 'Failed to switch chunks.', 'error');
            }
        });
    }
    
    createProgressBars(progressSection) {
        const totalChunks = this.player.totalChunks;
        this.clearSegmentCache();
        
        // Create single progress container
        const progressContainer = document.createElement('div');
        progressContainer.className = 'progress-container';
        progressContainer.id = 'progressBar';
        progressContainer.addEventListener('click', (event) => {
            this.handleProgressContainerClick(event);
        });
        
        // Create segments for each chunk
        for (let i = 0; i < totalChunks; i++) {
            const segment = document.createElement('div');
            segment.className = 'progress-segment';
            segment.dataset.chunkIndex = i;
            
            const segmentFill = document.createElement('div');
            segmentFill.className = 'progress-segment-fill';
            
            segment.appendChild(segmentFill);
            progressContainer.appendChild(segment);
            this.segmentEntries.push({ segment, segmentFill });
        }
        this.progressContainer = progressContainer;
        progressSection.appendChild(progressContainer);
        this.syncSegmentAvailability();
    }

    applySegmentState(index, currentChunkIndex, currentProgressText) {
        const entry = this.segmentEntries[index];
        const segment = entry?.segment;
        const segmentFill = entry?.segmentFill;
        if (!segment || !segmentFill) return;

        const isActive = index === currentChunkIndex;
        segment.classList.toggle('active', isActive);

        let targetWidth = '0%';
        if (index < currentChunkIndex) {
            targetWidth = '100%';
        } else if (isActive) {
            targetWidth = currentProgressText;
        }

        if (segmentFill.style.width !== targetWidth) {
            segmentFill.style.width = targetWidth;
        }
    }

    resolveFullChunkPageAnchorTime() {
        const sys = this.player;
        if (Number.isFinite(sys.selectedPageStartTime)) {
            return sys.selectedPageStartTime;
        }

        const pageIndex = typeof sys.resolveCurrentPageNavIndex === 'function'
            ? sys.resolveCurrentPageNavIndex()
            : null;
        if (Number.isInteger(pageIndex)) {
            return sys.getPageWordStartTime(pageIndex);
        }

        return 0;
    }

    resolvePageStartAnchorTime() {
        const sys = this.player;
        if (Number.isFinite(sys.selectedPageStartTime)) {
            return sys.selectedPageStartTime;
        }

        if (Number.isInteger(sys.currentPageIndex)) {
            return sys.getPageWordStartTime(sys.currentPageIndex);
        }

        return null;
    }

    resolveActiveSegmentProgressPercent(currentTime, duration) {
        if (!Number.isFinite(duration) || duration <= 0) {
            return 0;
        }

        const view = this.player.activeView;
        const audioEl = this.player.currentAudioElement;
        const isPlaying = !!(audioEl && !audioEl.paused);

        if (view === 'pageview' && isPlaying && Number.isFinite(currentTime)) {
            return Math.max(0, Math.min(100, (currentTime / duration) * 100));
        }

        let anchorTime = null;
        if (view === 'fullchunk') {
            anchorTime = this.resolveFullChunkPageAnchorTime();
        } else if (view === 'pageview') {
            anchorTime = Number.isFinite(currentTime)
                ? currentTime
                : this.resolvePageStartAnchorTime();
        }

        if (!Number.isFinite(anchorTime)) {
            anchorTime = Number.isFinite(currentTime) ? currentTime : 0;
        }

        return Math.max(0, Math.min(100, (anchorTime / duration) * 100));
    }

    syncProgressToSelectedPage() {
        this.lastRenderedProgress = null;
        this.lastRenderedAnchorTime = null;
        this.updateProgressBars();
    }
    
    updateProgressBars() {
        if (this.ensureSegmentCache()) {
            this.syncSegmentAvailability();
        }

        if (!this.player.currentAudioElement) {
            return;
        }
        
        const currentTime = this.player.currentAudioElement.currentTime;
        const duration = this.player.currentAudioElement.duration;
        
        // Verify audio element state before proceeding
        if (isNaN(currentTime) || isNaN(duration) || duration <= 0) {
            return;
        }

        if (!this.hasValidCache(this.player.totalChunks) && !this.ensureSegmentCache()) {
            return;
        }
        
        const maxIndex = this.segmentEntries.length - 1;
        if (maxIndex < 0) return;

        const rawChunkIndex = Number.isInteger(this.player.currentChunkIndex)
            ? this.player.currentChunkIndex
            : 0;
        const currentChunkIndex = Math.max(0, Math.min(maxIndex, rawChunkIndex));
        const view = this.player.activeView;
        const progress = this.resolveActiveSegmentProgressPercent(currentTime, duration);
        const currentProgressText = `${progress.toFixed(2)}%`;
        const anchorTime = view === 'fullchunk'
            ? this.resolveFullChunkPageAnchorTime()
            : (view === 'pageview' && !(this.player.currentAudioElement && !this.player.currentAudioElement.paused)
                ? (Number.isFinite(currentTime) ? currentTime : this.resolvePageStartAnchorTime())
                : currentTime);

        // Full pass only when chunk changed or cache was rebuilt.
        if (this.lastRenderedChunkIndex !== currentChunkIndex) {
            for (let i = 0; i < this.segmentEntries.length; i++) {
                this.applySegmentState(i, currentChunkIndex, currentProgressText);
            }
            this.lastRenderedChunkIndex = currentChunkIndex;
            this.lastRenderedProgress = currentProgressText;
            this.lastRenderedAnchorTime = anchorTime;
            return;
        }

        // During normal playback, only current segment width changes.
        if (
            this.lastRenderedProgress === currentProgressText &&
            this.lastRenderedAnchorTime === anchorTime
        ) {
            return;
        }
        this.applySegmentState(currentChunkIndex, currentChunkIndex, currentProgressText);
        this.lastRenderedProgress = currentProgressText;
        this.lastRenderedAnchorTime = anchorTime;
    }
    
    rebuildProgressBars(force = false) {
        // Rebuild progress bars if total chunks changed
        const currentTotal = document.querySelectorAll('.progress-segment').length;
        
        if (force || currentTotal !== this.player.totalChunks) {
            const progressSection = document.querySelector('.progress-section');
            if (progressSection) {
                progressSection.innerHTML = '';
                this.createProgressBars(progressSection);
            }
            return;
        }

        if (this.ensureSegmentCache()) {
            this.syncSegmentAvailability();
        }
    }
}
