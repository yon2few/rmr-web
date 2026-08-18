const LOADING_PHASES = Object.freeze([
    Object.freeze({
        key: 'request',
        label: 'Request Accepted',
        helper: 'The backend has the request and is starting the run.'
    }),
    Object.freeze({
        key: 'prepare-text',
        label: 'Preparing Text',
        helper: 'Formatting the text and planning chunk boundaries.'
    }),
    Object.freeze({
        key: 'start-synthesis',
        label: 'Starting Synthesis',
        helper: 'Creating the generation job for the first chunk.'
    }),
    Object.freeze({
        key: 'generate-audio',
        label: 'Generating Audio',
        helper: 'Waiting for the first chunk audio to come back.'
    }),
    Object.freeze({
        key: 'prepare-playback',
        label: 'Preparing Playback',
        helper: 'Timing words, building pages, and uploading audio.'
    }),
    Object.freeze({
        key: 'ready',
        label: 'Opening Reader',
        helper: 'Materializing the first chunk and loading playback.'
    })
]);

const LIVE_UPDATE_WARN_AFTER_MS = 12000;
const LIVE_UPDATE_STALE_AFTER_MS = 25000;
const TELEMETRY_REFRESH_MS = 250;

function formatDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error(`[AudioSystemLoading] Duration must be a non-negative finite number. Received: ${durationMs}`);
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

class AudioSystemLoading {
    constructor(player) {
        if (!player) {
            throw new Error('[AudioSystemLoading] player is required.');
        }

        this.player = player;
        this.progressSegments = [];
        this.clockIntervalId = null;
        this.autoPlayStorageKey = 'artReader.autoPlayOnReady';
        this.resetState();
    }

    // Opt-in: off unless the user has explicitly turned the loading-screen toggle on.
    isAutoPlayEnabled() {
        try {
            return window.localStorage.getItem(this.autoPlayStorageKey) === 'on';
        } catch (error) {
            return false;
        }
    }

    setAutoPlayEnabled(enabled) {
        try {
            window.localStorage.setItem(this.autoPlayStorageKey, enabled ? 'on' : 'off');
        } catch (error) {
            // Storage unavailable (private mode quotas) — preference simply won't
            // persist across reloads. Not worth interrupting the user over.
        }
    }

    configureSegmentLine() {
        if (!window.SegmentLineEmergence) {
            throw new Error('[AudioSystemLoading] SegmentLineEmergence module is required.');
        }

        this._tailConfig = window.SegmentLineEmergence.configure('Hi, welcome to ArT Reader.', this._durationSecs);
    }

    showLoadingInterface() {
        this.resetState();

        if (typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('loading');
        }
        if (typeof this.player.syncOverlayActionState === 'function') {
            this.player.syncOverlayActionState({ mode: 'loading', isPlaying: false, isGenerating: true });
        }

        const now = performance.now();
        this.initializeVisualElements();
        this.configureSegmentLine();
        this.sessionStartedAtMs = now;
        this.currentStageStartedAtMs = now;
        this.currentPhaseKey = 'request';
        this.phaseStateByKey.set('request', {
            startedAtMs: now,
            completedAtMs: null
        });
        this.setStatus('Submitting request');
        this.setStageDetail('Waiting for the backend to send the first live generation event.');
        this.startTelemetryClock();
        this.render();
    }

    hideLoadingInterface(options = {}) {
        this.resetState();

        // Auto-play callers set the pageview view themselves right after this
        // call; forcing an intermediate 'input' write here would just be
        // overwritten and risks a one-frame flash of the input view.
        if (options.skipViewTransition === true) {
            return;
        }

        if (this.player.activeView === 'loading' && typeof this.player.setActiveView === 'function') {
            this.player.setActiveView('input');
        }
    }

    resetState() {
        this.stopTelemetryClock();
        this.sessionStartedAtMs = null;
        this.currentStageStartedAtMs = null;
        this.lastBackendEventAtMs = null;
        this.currentStatus = '';
        this.currentDetail = '';
        this.currentStage = null;
        this.currentPhaseKey = null;
        this.phaseStateByKey = new Map(
            LOADING_PHASES.map((phase) => [phase.key, { startedAtMs: null, completedAtMs: null }])
        );
        this._durationSecs = null;
        this._tailConfig = null;
        this._lastFlipTens = null;
        this._lastFlipOnes = null;
        this.flipTensEl = null;
        this.flipOnesEl = null;
        this.syncWaitingVisualState(false);
        this.syncStaleVisualState(false);
        this.renderResetState();
    }

    requireElement(elementId) {
        const element = document.getElementById(elementId);
        if (!element) {
            throw new Error(`[AudioSystemLoading] Missing required element: ${elementId}`);
        }
        return element;
    }

    requireSelector(selector) {
        const element = document.querySelector(selector);
        if (!element) {
            throw new Error(`[AudioSystemLoading] Missing required element: ${selector}`);
        }
        return element;
    }

    getPhaseDefinitionByKey(phaseKey) {
        const phaseDefinition = LOADING_PHASES.find((phase) => phase.key === phaseKey);
        if (!phaseDefinition) {
            throw new Error(`[AudioSystemLoading] Unsupported loading phase: ${phaseKey}`);
        }
        return phaseDefinition;
    }

    getPhaseIndexByKey(phaseKey) {
        const phaseIndex = LOADING_PHASES.findIndex((phase) => phase.key === phaseKey);
        if (phaseIndex === -1) {
            throw new Error(`[AudioSystemLoading] Unsupported loading phase index lookup: ${phaseKey}`);
        }
        return phaseIndex;
    }

    setStatus(text) {
        if (typeof text !== 'string' || !text.trim()) {
            throw new Error('[AudioSystemLoading] Status text must be a non-empty string.');
        }
        this.currentStatus = text;
    }

    setStageDetail(text) {
        if (typeof text !== 'string' || !text.trim()) {
            throw new Error('[AudioSystemLoading] Stage detail text must be a non-empty string.');
        }
        this.currentDetail = text;
    }

    syncWaitingVisualState(isWaiting) {
        if (typeof isWaiting !== 'boolean') {
            throw new Error('[AudioSystemLoading] Waiting visual state must be a boolean.');
        }

        const loadingInterface = this.requireSelector('.loading-interface');
        loadingInterface.classList.toggle('is-paused-waiting', isWaiting);
    }

    syncStaleVisualState(isStale) {
        if (typeof isStale !== 'boolean') {
            throw new Error('[AudioSystemLoading] Stale visual state must be a boolean.');
        }

        const loadingInterface = this.requireSelector('.loading-interface');
        loadingInterface.classList.toggle('is-stale', isStale);
    }

    initializeVisualElements() {
        const progressTrack = this.requireElement('loadingProgressTrack');
        progressTrack.innerHTML = '';
        this.progressSegments = LOADING_PHASES.map((phase) => {
            const segment = document.createElement('div');
            segment.className = 'loading-progress-segment';
            segment.dataset.phaseKey = phase.key;
            progressTrack.appendChild(segment);
            return segment;
        });

        this._durationSecs = 26;

        const loadingInterface = document.getElementById('loadingInterface');
        const segmentsContainer = loadingInterface ? loadingInterface.querySelector('[data-role="segments"]') : null;
        if (segmentsContainer) {
            segmentsContainer.innerHTML = Array.from({ length: this._durationSecs }, (_, i) =>
                `<span class="timer-segment" data-index="${i}"></span>`
            ).join('');
        }

        this.flipTensEl = loadingInterface ? loadingInterface.querySelector('[data-role="flip-tens"]') : null;
        this.flipOnesEl = loadingInterface ? loadingInterface.querySelector('[data-role="flip-ones"]') : null;

        const initialText = String(this._durationSecs).padStart(2, '0');
        this._lastFlipTens = initialText[0];
        this._lastFlipOnes = initialText[1];
        if (this.flipTensEl) this.flipTensEl.textContent = initialText[0];
        if (this.flipOnesEl) this.flipOnesEl.textContent = initialText[1];
    }

    renderResetState() {
        const flipTensEl = document.querySelector('[data-role="flip-tens"]');
        const flipOnesEl = document.querySelector('[data-role="flip-ones"]');
        if (flipTensEl) {
            flipTensEl.textContent = '2';
        }
        if (flipOnesEl) {
            flipOnesEl.textContent = '6';
        }

        const loadingInterface = document.getElementById('loadingInterface');
        if (loadingInterface) {
            loadingInterface.querySelectorAll('.timer-segment').forEach((seg) => seg.classList.remove('is-spent'));
            const sentenceEl = loadingInterface.querySelector('[data-role="segment-line-sentence"]');
            if (sentenceEl) {
                sentenceEl.textContent = '';
            }
        }

        const stepsEl = document.getElementById('stepsDisplay');
        if (stepsEl) {
            stepsEl.textContent = '';
        }

        const stageDetailEl = document.getElementById('loadingStageDetail');
        if (stageDetailEl) {
            stageDetailEl.textContent = '';
        }

        const stageIndexEl = document.getElementById('loadingStageIndex');
        if (stageIndexEl) {
            stageIndexEl.textContent = `Stage 1 of ${LOADING_PHASES.length}`;
        }

        const confidenceEl = document.getElementById('loadingConfidenceMessage');
        if (confidenceEl) {
            confidenceEl.textContent = '';
        }

        const eventAgeEl = document.getElementById('loadingEventAge');
        if (eventAgeEl) {
            eventAgeEl.textContent = 'Waiting for first live event';
        }
    }

    startTelemetryClock() {
        if (this.clockIntervalId !== null) {
            return;
        }

        this.clockIntervalId = window.setInterval(() => {
            this.render();
        }, TELEMETRY_REFRESH_MS);
    }

    stopTelemetryClock() {
        if (this.clockIntervalId !== null) {
            clearInterval(this.clockIntervalId);
            this.clockIntervalId = null;
        }
    }

    markLiveUpdate(atMs) {
        if (!Number.isFinite(atMs)) {
            throw new Error(`[AudioSystemLoading] markLiveUpdate requires a finite timestamp. Received: ${atMs}`);
        }
        this.lastBackendEventAtMs = atMs;
    }

    transitionToPhase(phaseKey, atMs) {
        if (!Number.isFinite(atMs)) {
            throw new Error(`[AudioSystemLoading] transitionToPhase requires a finite timestamp. Received: ${atMs}`);
        }

        this.getPhaseDefinitionByKey(phaseKey);

        if (this.currentPhaseKey === phaseKey) {
            const currentPhaseState = this.phaseStateByKey.get(phaseKey);
            if (!currentPhaseState.startedAtMs) {
                currentPhaseState.startedAtMs = atMs;
            }
            return;
        }

        if (this.currentPhaseKey) {
            const previousPhaseState = this.phaseStateByKey.get(this.currentPhaseKey);
            if (!previousPhaseState.startedAtMs) {
                previousPhaseState.startedAtMs = atMs;
            }
            previousPhaseState.completedAtMs = atMs;
        }

        const nextPhaseState = this.phaseStateByKey.get(phaseKey);
        if (!nextPhaseState.startedAtMs) {
            nextPhaseState.startedAtMs = atMs;
        }

        this.currentPhaseKey = phaseKey;
        this.currentStageStartedAtMs = atMs;
    }

    render() {
        if (!this.sessionStartedAtMs) {
            return;
        }

        const now = performance.now();
        const totalElapsedMs = now - this.sessionStartedAtMs;
        const currentStageElapsedMs = this.currentStageStartedAtMs ? now - this.currentStageStartedAtMs : 0;
        const eventAgeMs = this.lastBackendEventAtMs ? now - this.lastBackendEventAtMs : null;
        const currentPhaseIndex = this.currentPhaseKey ? this.getPhaseIndexByKey(this.currentPhaseKey) : 0;

        const countdownSecs = Math.max(0, (this._durationSecs || 26) - Math.floor(totalElapsedMs / 1000));
        this.renderSegmentLine(countdownSecs);
        this.requireElement('loadingStageIndex').textContent = `Stage ${currentPhaseIndex} of ${LOADING_PHASES.length}`;
        this.requireElement('stepsDisplay').textContent = this.currentStatus;
        this.requireElement('loadingStageDetail').textContent = this.currentDetail;
        this.requireElement('loadingEventAge').textContent = this.buildEventAgeLabel(eventAgeMs);
        this.requireElement('loadingConfidenceMessage').textContent = this.buildConfidenceMessage({
            eventAgeMs,
            currentStageElapsedMs
        });

        this.syncStaleVisualState(eventAgeMs !== null && eventAgeMs >= LIVE_UPDATE_STALE_AFTER_MS);
        this.renderProgressTrack(currentPhaseIndex);
    }

    buildEventAgeLabel(eventAgeMs) {
        if (eventAgeMs === null) {
            return 'Waiting for first live event';
        }
        if (eventAgeMs < 1000) {
            return 'Last update just now';
        }

        return `Last update ${formatDuration(eventAgeMs)} ago`;
    }

    buildConfidenceMessage({ eventAgeMs, currentStageElapsedMs }) {
        if (eventAgeMs === null) {
            return 'Run is active. Waiting for the first live update.';
        }

        if (this.currentStage === 'chunk-tts-waiting') {
            return `Still active. Remote speech generation is in progress for ${formatDuration(currentStageElapsedMs)}.`;
        }

        if (eventAgeMs < LIVE_UPDATE_WARN_AFTER_MS) {
            return `Still active. Current phase has been running for ${formatDuration(currentStageElapsedMs)}.`;
        }

        if (eventAgeMs < LIVE_UPDATE_STALE_AFTER_MS) {
            return `No new event for ${formatDuration(eventAgeMs)}. Still on ${this.currentStatus}.`;
        }

        return `No new event for ${formatDuration(eventAgeMs)}. This phase is taking longer than usual.`;
    }

    renderSegmentLine(remaining) {
        const clamped = Math.max(0, Math.floor(remaining));
        const elapsed = (this._durationSecs || 26) - clamped;
        const text = String(clamped).padStart(2, '0');
        const tens = text[0];
        const ones = text[1];

        if (this.flipTensEl && tens !== this._lastFlipTens) {
            this.flipTensEl.classList.remove('is-flipping');
            void this.flipTensEl.offsetWidth;
            this.flipTensEl.textContent = tens;
            this.flipTensEl.classList.add('is-flipping');
            this._lastFlipTens = tens;
        }

        if (this.flipOnesEl && ones !== this._lastFlipOnes) {
            this.flipOnesEl.classList.remove('is-flipping');
            void this.flipOnesEl.offsetWidth;
            this.flipOnesEl.textContent = ones;
            this.flipOnesEl.classList.add('is-flipping');
            this._lastFlipOnes = ones;
        }

        const loadingInterface = document.getElementById('loadingInterface');
        if (loadingInterface) {
            loadingInterface.querySelectorAll('.timer-segment').forEach((seg) => {
                seg.classList.toggle('is-spent', Number(seg.dataset.index) < elapsed);
            });

            if (this._tailConfig && window.SegmentLineEmergence) {
                window.SegmentLineEmergence.apply(elapsed, loadingInterface, this._tailConfig);
            }
        }
    }

    renderProgressTrack(currentPhaseIndex) {
        this.progressSegments.forEach((segment, index) => {
            segment.classList.toggle('is-complete', index < currentPhaseIndex);
            segment.classList.toggle('is-active', index === currentPhaseIndex);
        });
    }

    handleSubmissionAccepted({ totalChunks }) {
        if (!Number.isInteger(totalChunks) || totalChunks < 1) {
            throw new Error(`[AudioSystemLoading] totalChunks must be a positive integer. Received: ${totalChunks}`);
        }

        const now = performance.now();
        this.currentStage = 'submission-accepted';
        this.markLiveUpdate(now);
        this.syncWaitingVisualState(false);
        this.setStatus('Request accepted');
        this.setStageDetail(`Building ${totalChunks} part${totalChunks === 1 ? '' : 's'} and waiting for first-chunk progress.`);
        this.render();
    }

    handleChunkReady({ chunkIndex, totalChunks }) {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
            throw new Error(`[AudioSystemLoading] chunkIndex must be a non-negative integer. Received: ${chunkIndex}`);
        }
        if (!Number.isInteger(totalChunks) || totalChunks < 1) {
            throw new Error(`[AudioSystemLoading] totalChunks must be a positive integer. Received: ${totalChunks}`);
        }
        if (chunkIndex !== 0) {
            return;
        }

        const now = performance.now();
        this.currentStage = 'chunk-ready';
        this.markLiveUpdate(now);
        this.transitionToPhase('ready', now);
        this.syncWaitingVisualState(false);
        this.setStatus('Opening reader');
        this.setStageDetail(
            totalChunks === 1
                ? 'First chunk ready. Initializing playback.'
                : `First chunk ready. ${totalChunks - 1} more part${totalChunks - 1 === 1 ? '' : 's'} still generating.`
        );
        this.render();
    }

    handleSubmissionComplete({ totalChunks }) {
        if (!Number.isInteger(totalChunks) || totalChunks < 1) {
            throw new Error(`[AudioSystemLoading] totalChunks must be a positive integer. Received: ${totalChunks}`);
        }

        const now = performance.now();
        this.currentStage = 'complete';
        this.markLiveUpdate(now);
        this.transitionToPhase('ready', now);
        this.syncWaitingVisualState(false);
        this.setStatus('Reader ready');
        this.setStageDetail(`Generation finished for all ${totalChunks} part${totalChunks === 1 ? '' : 's'}.`);
        this.render();
    }

    handleSubmissionFailed(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.stopTelemetryClock();
        this.currentStage = 'failed';
        this.syncWaitingVisualState(false);
        this.syncStaleVisualState(false);
        this.setStatus('Generation failed');
        this.setStageDetail(message);
        if (this.sessionStartedAtMs) {
            this.render();
        }
    }
}
