// Caption Original - Brain-friendly word highlighting (Original Style)
import { ArtReaderHighlightingConfig } from './config.js';
import { ArtReaderColorCycler } from './color-cycler.js';
import { PauseStateHandler } from './pause-state.js';
import { WordDomRenderer } from './word-dom-renderer.js';

export class CaptionOriginal {
    // options.getAudioElement  REQUIRED () => HTMLAudioElement | null
    // options.getContainer     REQUIRED () => HTMLElement | null
    // options.getWords         REQUIRED () => Array<{word,start,end}> | null
    // options.onSeek           optional (startTime, wordEl) => void
    // options.onSpeakingPartAdvance  optional () => void
    // options.config           optional override of the frozen shared config
    constructor(options) {
        this.highlightingConfig = options.config || ArtReaderHighlightingConfig;
        this._getAudioElement = options.getAudioElement;
        this._getContainer = options.getContainer;
        this._getWords = options.getWords;
        this._onSeek = options.onSeek || (() => {});
        this._onSpeakingPartAdvance = options.onSpeakingPartAdvance || (() => {});
        this.animationFrameId = null; // rAF-driven highlighting loop
        this.activeWordIndices = [];
        this.lookaheadIndices = [];
        this.lookbackIndices = [];
        this.currentPrimaryWordIndex = null;
        this.lookaheadCount = this.highlightingConfig.context.lookaheadCount;
        this.lookbackCount = this.highlightingConfig.context.lookbackCount;
        this.isPauseState = false;
        this.isTransitioningPage = false;
        this.lastRenderPaused = false;
        this.wordCursorIndex = 0;
        // Tracks the last-seen `words` array reference (not a page index - the
        // engine doesn't know what a "page" is) to know when to reset the
        // binary-search cursor. Each host's getWords() returns a distinct array
        // per word-block, so reference identity is a valid change signal.
        this.cursorWordsRef = null;
        this.wordStateByIndex = [];
        this.pauseStateHandler = new PauseStateHandler(this);
        this.wordDomRenderer = new WordDomRenderer();
        // Style Rotation Logic (palette lives in ArtReaderHighlightingConfig) -
        // moved off AudioSystem, which used to own these two fields directly.
        this.currentColorIndex = 0;
        this.lastSpeakingPartIndex = null;
    }

    get isPaused() {
        return this.isPauseState;
    }

    setTransitioningPage(value) {
        this.isTransitioningPage = !!value;
    }

    startHighlighting() {
        this.isPauseState = false;
        this.startAnimationLoop();
    }
    
    stopHighlighting(options = {}) {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        this.isPauseState = true;
        const skipPauseRender = !!options.skipPauseRender;
        
        // Delay showing pause state to let timeupdate events finish
        setTimeout(() => {
            if (this.isPauseState && !skipPauseRender) {
                this.pauseStateHandler.showPauseState();
            }
        }, this.highlightingConfig.timings.pauseDelayMs);
    }
    
    startAnimationLoop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        
        const loop = () => {
            const audioEl = this.getAudioElement();
            if (audioEl && !audioEl.paused) {
                const currentTime = audioEl.currentTime;
                this.updateWordHighlighting(currentTime);
                this.animationFrameId = requestAnimationFrame(loop);
            } else {
                this.animationFrameId = null;
            }
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }
    
    // updateWordHighlighting() drivers:
    // 1) rAF loop in startAnimationLoop()
    // 2) timeupdate fallback via audio-playback.js updateHighlighting()
    // 3) post-render one-shot in audio-input-display.js after page rebuild
    // 4) click-to-seek in click-to-seek-manager.js (word + page handlers)
    updateWordHighlighting(currentTime) {
        // CRITICAL: Don't compute/cached-highlight while the page DOM is being rebuilt.
        // Otherwise we "use up" the first-word highlight on the old DOM and then skip reapplying.
        if (this.isTransitioningPage) {
            return;
        }

        // Use page words if available, otherwise fall back to full words array
        const words = this.getCurrentPageWords();

        if (!words || words.length === 0) {
            return;
        }
        
        let domWords;
        try {
            domWords = this.getCurrentDomWords(words.length);
        } catch (err) {
            return;
        }
        if (!domWords || domWords.length !== words.length) {
            return;
        }

        if (this.cursorWordsRef !== words) {
            this.cursorWordsRef = words;
            this.wordCursorIndex = 0;
        }

        const buffer = 0.1;
        // Incoming page lands before speech; word 0 is already the sit highlight.
        const firstWordBuffer = 0.0;
        let primaryIndex = this.findPrimaryIndexAtTime(currentTime, words);
        const activeWordIndices = this.collectActiveIndices(
            currentTime,
            words,
            primaryIndex,
            buffer,
            firstWordBuffer
        );

        // If there is a pause after the last word but before audio end, keep last word active.
        let isPaused = false;
        if (activeWordIndices.length === 0 && words.length > 0) {
            const lastWord = words[words.length - 1];
            const audioDuration = Number(this.getAudioElement()?.duration) || Infinity;

            if (currentTime > lastWord.end && currentTime < audioDuration) {
                activeWordIndices.push(words.length - 1);
                primaryIndex = words.length - 1;
                isPaused = true;
            }
        }

        if (primaryIndex === null) {
            primaryIndex = 0;
        }
        
        // Calculate lookahead and lookback indices
        const lookaheadIndices = [];
        for (let k = 1; k <= this.lookaheadCount; k++) {
            const idx = primaryIndex + k;
            if (idx < words.length) lookaheadIndices.push(idx);
        }
        
        const lookbackIndices = [];
        for (let k = 1; k <= this.lookbackCount; k++) {
            const idx = primaryIndex - k;
            if (idx >= 0) lookbackIndices.push(idx);
        }
        
        // Only update if there's a change
        const hasChanged = this.hasHighlightingChanged(
            activeWordIndices,
            lookaheadIndices,
            lookbackIndices,
            primaryIndex,
            isPaused
        );
        
        if (hasChanged) {
            this.updateHighlightingStates(
                activeWordIndices,
                lookaheadIndices,
                lookbackIndices,
                primaryIndex,
                isPaused,
                words.length,
                domWords
            );
        }
    }
    
    getCurrentPageWords() {
        return this._getWords();
    }
    
    findWordAtTime(targetTime, words) {
        if (!words || words.length === 0) return null;
        const index = this.findWordIndexAtTime(targetTime, words);
        return index >= 0 ? words[index] : null;
    }

    findPrimaryIndexAtTime(targetTime, words) {
        if (!words || words.length === 0) return 0;

        let index = Number.isInteger(this.wordCursorIndex) ? this.wordCursorIndex : 0;
        index = Math.max(0, Math.min(words.length - 1, index));

        while (index < words.length - 1 && targetTime > words[index].end) {
            index += 1;
        }

        while (index > 0 && targetTime < words[index].start) {
            index -= 1;
        }

        if (targetTime >= words[index].start && targetTime <= words[index].end) {
            this.wordCursorIndex = index;
            return index;
        }

        index = this.findWordIndexAtTime(targetTime, words);
        this.wordCursorIndex = index;
        return index;
    }

    findWordIndexAtTime(targetTime, words) {
        if (!words || words.length === 0) return -1;

        let low = 0;
        let high = words.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const word = words[mid];
            if (targetTime < word.start) {
                high = mid - 1;
            } else if (targetTime > word.end) {
                low = mid + 1;
            } else {
                return mid;
            }
        }

        const candidates = [];
        if (high >= 0) candidates.push(high);
        if (low < words.length) candidates.push(low);

        let closestIndex = 0;
        let minDistance = Infinity;
        for (const i of candidates) {
            const word = words[i];
            const distanceToStart = Math.abs(targetTime - word.start);
            const distanceToEnd = Math.abs(targetTime - word.end);
            const minWordDistance = Math.min(distanceToStart, distanceToEnd);
            if (minWordDistance < minDistance) {
                minDistance = minWordDistance;
                closestIndex = i;
            }
        }

        return closestIndex;
    }

    collectActiveIndices(currentTime, words, primaryIndex, buffer, firstWordBuffer) {
        if (!Number.isInteger(primaryIndex) || primaryIndex < 0 || primaryIndex >= words.length) {
            return [];
        }

        const activeSet = new Set();
        if (this.isWordActiveAtTime(primaryIndex, currentTime, words, buffer, firstWordBuffer)) {
            activeSet.add(primaryIndex);
        }

        for (let offset = 1; offset <= 2; offset++) {
            const left = primaryIndex - offset;
            const right = primaryIndex + offset;
            if (left >= 0 && this.isWordActiveAtTime(left, currentTime, words, buffer, firstWordBuffer)) {
                activeSet.add(left);
            }
            if (right < words.length && this.isWordActiveAtTime(right, currentTime, words, buffer, firstWordBuffer)) {
                activeSet.add(right);
            }
        }

        if (activeSet.size === 0) {
            return [];
        }

        let minIndex = Math.min(...activeSet);
        let maxIndex = Math.max(...activeSet);

        while (minIndex - 1 >= 0 && this.isWordActiveAtTime(minIndex - 1, currentTime, words, buffer, firstWordBuffer)) {
            minIndex -= 1;
            activeSet.add(minIndex);
        }
        while (maxIndex + 1 < words.length && this.isWordActiveAtTime(maxIndex + 1, currentTime, words, buffer, firstWordBuffer)) {
            maxIndex += 1;
            activeSet.add(maxIndex);
        }

        return Array.from(activeSet).sort((a, b) => a - b);
    }

    isWordActiveAtTime(index, currentTime, words, buffer, firstWordBuffer) {
        const word = words[index];
        if (!word) return false;

        if (index === 0) {
            // Once this page is on screen, keep word 0 lit until it has been spoken
            // so a T-0.5s land does not sit empty then pop.
            const effectiveEnd = word.end + buffer;
            return currentTime <= effectiveEnd;
        }

        const startBuffer = this.getLengthAwareBuffer(word, buffer);
        const effectiveStart = Math.max(0, word.start - startBuffer);
        const effectiveEnd = word.end + startBuffer;
        return currentTime >= effectiveStart && currentTime <= effectiveEnd;
    }

    getLengthAwareBuffer(word, fallbackBuffer) {
        const raw = (word?.word ?? word?.text ?? '').toString();
        const cleaned = raw.replace(/[^A-Za-z0-9]/g, '');
        const length = cleaned.length;

        if (length > 0 && length <= 2) {
            return this.highlightingConfig.buffers.short2;
        }
        if (length === 3) {
            return this.highlightingConfig.buffers.short3;
        }
        return fallbackBuffer;
    }
    
    hasHighlightingChanged(activeIndices, lookaheadIndices, lookbackIndices, primaryIndex, isPaused) {
        return activeIndices.length !== this.activeWordIndices.length ||
               !this.activeWordIndices.every((index, i) => index === activeIndices[i]) ||
               lookaheadIndices.length !== this.lookaheadIndices.length ||
               !this.lookaheadIndices.every((index, i) => index === lookaheadIndices[i]) ||
               lookbackIndices.length !== this.lookbackIndices.length ||
               !this.lookbackIndices.every((index, i) => index === lookbackIndices[i]) ||
               this.currentPrimaryWordIndex !== primaryIndex ||
               this.lastRenderPaused !== isPaused;
    }
    
    updateHighlightingStates(activeIndices, lookaheadIndices, lookbackIndices, primaryIndex, isPaused = false, wordCount = 0, allWords = []) {
        if (allWords.length === 0) return;
        
        const previousActive = this.activeWordIndices;
        const previousLookahead = this.lookaheadIndices;
        const previousLookback = this.lookbackIndices;
        const previousPrimary = this.currentPrimaryWordIndex;
        const previousPaused = this.lastRenderPaused;
        
        const activeSet = new Set(activeIndices);
        const lookaheadSet = new Set(lookaheadIndices);
        const lookbackSet = new Set(lookbackIndices);
        
        const indicesToUpdate = new Set([
            ...previousActive,
            ...previousLookahead,
            ...previousLookback,
            ...activeIndices,
            ...lookaheadIndices,
            ...lookbackIndices,
        ]);
        
        if (Number.isInteger(previousPrimary)) {
            indicesToUpdate.add(previousPrimary);
        }
        if (Number.isInteger(primaryIndex)) {
            indicesToUpdate.add(primaryIndex);
        }
        
        if (!Number.isInteger(previousPrimary) || !Number.isInteger(primaryIndex)) {
            for (let i = 0; i < wordCount; i++) {
                indicesToUpdate.add(i);
            }
        } else if (previousPrimary !== primaryIndex) {
            const rangeStart = Math.min(previousPrimary, primaryIndex) + 1;
            const rangeEnd = Math.max(previousPrimary, primaryIndex);
            for (let i = rangeStart; i <= rangeEnd; i++) {
                indicesToUpdate.add(i);
            }
        }
        
        if (previousPaused !== isPaused && wordCount > 0) {
            indicesToUpdate.add(wordCount - 1);
        }
        
        indicesToUpdate.forEach((index) => {
            if (index < 0 || index >= wordCount) return;
            const wordElement = allWords[index];
            if (!wordElement) return;
            
            const nextState = this.resolveWordState(
                index,
                activeSet,
                lookaheadSet,
                lookbackSet,
                primaryIndex,
                isPaused,
                wordCount
            );
            this.applyWordState(wordElement, index, nextState);
        });
        
        // Store new indices
        this.activeWordIndices = activeIndices.slice();
        this.lookaheadIndices = lookaheadIndices.slice();
        this.lookbackIndices = lookbackIndices.slice();
        this.currentPrimaryWordIndex = primaryIndex;
        this.lastRenderPaused = isPaused;
    }
    
    resolveWordState(index, activeSet, lookaheadSet, lookbackSet, primaryIndex, isPaused, wordCount) {
        if (activeSet.has(index)) {
            if (isPaused && index === wordCount - 1) {
                return 'paused';
            }
            return 'active';
        }
        
        if (lookbackSet.has(index)) {
            return 'lookback';
        }
        
        if (lookaheadSet.has(index)) {
            return 'lookahead';
        }
        
        if (index < primaryIndex) {
            return 'inactive-read';
        }
        return 'inactive-future';
    }
    
    getClassesForState(state) {
        switch (state) {
            case 'active':
                return ['active'];
            case 'paused':
                return ['active', 'paused'];
            case 'lookback':
                return ['lookback'];
            case 'lookahead':
                return ['lookahead'];
            case 'inactive-read':
                return ['inactive-read'];
            case 'inactive-future':
                return ['inactive-future'];
            default:
                return [];
        }
    }
    
    applyWordState(wordElement, index, nextState) {
        const previousState = this.wordStateByIndex[index];
        if (previousState === nextState) return;
        
        const previousClasses = this.getClassesForState(previousState);
        if (previousClasses.length > 0) {
            wordElement.classList.remove(...previousClasses);
        } else {
            wordElement.classList.remove(
                'active',
                'lookahead',
                'lookback',
                'inactive-read',
                'inactive-future',
                'paused',
                'paused-word'
            );
        }
        
        const nextClasses = this.getClassesForState(nextState);
        if (nextClasses.length > 0) {
            wordElement.classList.add(...nextClasses);
        }
        
        this.wordStateByIndex[index] = nextState;
    }
    
    // --- Host accessors ---
    // The engine never reaches into a host object directly; every host-specific
    // value comes through one of these three callbacks, injected at construction.
    getAudioElement() {
        return this._getAudioElement();
    }

    getContainer() {
        return this._getContainer();
    }

    getCurrentDomWords(expectedCount = null) {
        return this.wordDomRenderer.resolveCurrentWordElements(this.getContainer(), expectedCount);
    }

    // --- Word DOM ownership (page-render pipeline entry points) ---
    // These replace the word-span-creation/line-balancing/caching steps that
    // audio-input-display.js previously performed itself via
    // ClickToSeekManager.processWords + PageLineBalancer.optimizeLineBalance +
    // its own cacheWordElements()/applyInitialHighlighting().

    buildWordContainer(words) {
        return this.wordDomRenderer.createWordSpans(words);
    }

    balanceWordContainer(container, callback) {
        this.wordDomRenderer.balanceLines(container, callback);
    }

    cacheCurrentWordElements() {
        this.wordDomRenderer.cacheWordElements(this.getContainer());
    }

    applyInitialWordHighlighting() {
        this.wordDomRenderer.applyInitialHighlighting();
    }

    takeCachedWordElements() {
        return this.wordDomRenderer.takeCachedElements();
    }

    // --- Word-level click-to-seek ---
    // Page-level click-to-seek (FullChunk mode) has no engine-agnostic meaning
    // - it operates on page-container DOM and progress-bar sync concepts the
    // engine has no reason to know about. It stays host-owned - see
    // reader-playback-adapter.js's attachPageClickToSeek().
    attachWordClickToSeek(container) {
        container.onclick = (e) => {
            const rawTarget = e.target;
            const target = rawTarget && rawTarget.nodeType === Node.TEXT_NODE
                ? rawTarget.parentElement
                : rawTarget;
            if (!target || typeof target.closest !== 'function') return;

            const wordSpan = target.closest('.word, .word-lite');
            if (!wordSpan) return;

            e.stopPropagation();
            this._handleWordClick(wordSpan, container);
        };
    }

    _handleWordClick(wordSpan, container) {
        const startTime = parseFloat(wordSpan.dataset.start);
        if (!Number.isFinite(startTime)) return;

        const textDisplay = container || this.getContainer();
        const allWords = textDisplay.querySelectorAll('.word, .word-lite');
        allWords.forEach((word) => word.classList.remove('selected'));
        wordSpan.classList.add('selected');

        this.updateWordHighlighting(startTime);
        this._onSeek(startTime, wordSpan);
    }

    // --- Speaker-part color rotation ---
    // Was AudioSystem.updateHighlightColor() delegating to
    // ArtReaderColorCycler.next(this, ...) with AudioSystem itself as the
    // mutable state holder (currentColorIndex/lastSpeakingPartIndex lived on
    // AudioSystem). State now lives here instead.

    advanceColorForSpeakingPart(speakingPartIndex) {
        ArtReaderColorCycler.next(
            this,
            speakingPartIndex,
            this.highlightingConfig.palette,
            () => this._onSpeakingPartAdvance()
        );
    }

    resetColorState() {
        this.lastSpeakingPartIndex = null;
    }

    // --- Per-page-turn state reset ---
    // Was audio-input-display.js directly poking 8 private fields on this
    // class with no API boundary, right after a page rebuild settles.
    resetBlockState() {
        this.currentPrimaryWordIndex = null;
        this.activeWordIndices = [];
        this.lookaheadIndices = [];
        this.lookbackIndices = [];
        this.lastRenderPaused = false;
        this.wordStateByIndex = [];
        this.wordCursorIndex = 0;
        this.cursorWordsRef = null;
    }

}

window.CaptionOriginal = CaptionOriginal;
