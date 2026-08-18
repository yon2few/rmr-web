// Audio Input Data Core Module - Handles data loading and audio initialization
class AudioSystemInputDataCore {
    constructor(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[DataCore] player is required.');
        }
        this.player = player;
    }

    async resolveStableAudioUrl(chunk) {
        if (!chunk || typeof chunk !== 'object') {
            throw new Error('[DataCore] resolveStableAudioUrl requires a chunk object.');
        }
        if (typeof chunk.audioUrl !== 'string' || !chunk.audioUrl.trim()) {
            throw new Error('[DataCore] Chunk audioUrl is missing.');
        }

        if (typeof chunk.playbackAudioUrl === 'string' && chunk.playbackAudioUrl.trim()) {
            return chunk.playbackAudioUrl;
        }

        const sourceAudioUrl = chunk.audioUrl.trim();
        if (sourceAudioUrl.startsWith('blob:')) {
            chunk.playbackAudioUrl = sourceAudioUrl;
            return chunk.playbackAudioUrl;
        }

        const response = await fetch(sourceAudioUrl);
        if (!response.ok) {
            throw new Error(`[DataCore] Failed to fetch chunk audio for stable playback URL (status ${response.status}).`);
        }

        const audioBlob = await response.blob();
        if (!(audioBlob instanceof Blob) || audioBlob.size <= 0) {
            throw new Error('[DataCore] Chunk audio fetch returned an empty blob.');
        }

        chunk.playbackAudioUrl = URL.createObjectURL(audioBlob);
        return chunk.playbackAudioUrl;
    }

    sanitizePageWords(words) {
        if (!Array.isArray(words) || words.length === 0) return [];

        const sanitized = [];
        let insideTag = false;

        for (let i = 0; i < words.length; i++) {
            const wordObj = words[i];
            const tokenRaw = (wordObj?.word ?? wordObj?.text ?? '').toString();
            const token = tokenRaw.trim();
            if (!token) continue;

            const lower = token.toLowerCase();
            const hasLt = token.includes('<');
            const hasGt = token.includes('>');
            const opensBreakTag = lower.startsWith('<break') || lower.startsWith('</break');
            const isTagFragment = insideTag || hasLt || opensBreakTag;

            if (isTagFragment) {
                insideTag = insideTag || hasLt || opensBreakTag;
                if (hasGt || lower.endsWith('/>') || token === '/>' || token === '>') {
                    insideTag = false;
                }
                continue;
            }

            sanitized.push({ ...wordObj });
        }

        return sanitized;
    }

    preparePagesData(pages) {
        if (!Array.isArray(pages) || pages.length === 0) return [];

        const preparedPages = [];
        let globalWordIndex = 0;

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i] || {};
            const cleanedWords = this.sanitizePageWords(page.words);
            if (!cleanedWords.length) {
                continue;
            }

            const normalizedWords = cleanedWords.map((wordObj) => {
                const wordText = (wordObj.word ?? wordObj.text ?? '').toString();
                const normalized = {
                    ...wordObj,
                    word: wordText,
                    text: (wordObj.text ?? wordText).toString(),
                    index: globalWordIndex,
                };
                globalWordIndex += 1;
                return normalized;
            });

            const firstStart = Number(normalizedWords[0]?.start);
            const lastEnd = Number(normalizedWords[normalizedWords.length - 1]?.end);
            const pageStart = typeof page.start === 'number' ? page.start : (Number.isFinite(firstStart) ? firstStart : 0);
            const pageEnd = typeof page.end === 'number' ? page.end : (Number.isFinite(lastEnd) ? lastEnd : pageStart);

            preparedPages.push({
                ...page,
                pageIndex: preparedPages.length,
                pageNumber: preparedPages.length + 1,
                start: pageStart,
                end: pageEnd,
                text: normalizedWords.map((w) => w.word).join(' '),
                words: normalizedWords,
            });
        }

        return preparedPages;
    }
    
    loadPagesData(pages, context = {}) {
        if (!pages || pages.length === 0) {
            throw new Error('[DataCore] No pages data received.');
        }

        const preparedPages = this.preparePagesData(pages);
        if (!preparedPages.length) {
            throw new Error('[DataCore] No renderable words after sanitization.');
        }

        const chunkIndex = Number.isInteger(context.chunkIndex) ? context.chunkIndex : null;

        if (this.player.captioning && this.player.captioning.isTransitioningPage) {
            throw new Error(
                `[DataCore] Cannot load pages${Number.isInteger(chunkIndex) ? ` for chunk ${chunkIndex}` : ''} ` +
                `while PageView transition is in flight.`
            );
        }

        this.player.pages = preparedPages;
    }
    
    async adoptPreloadedAudioElement(reused, fallbackAudioUrl) {
        // reused can be { audio, audioUrl } from ChunkLoadCoordinator.consumeHydratedChunk()
        const audio = reused?.audio || reused;
        const audioUrl = reused?.audioUrl || fallbackAudioUrl;

        if (!audio) return false;

        // Clean up old current audio element safely
        if (this.player.currentAudioElement && this.player.currentAudioElement !== audio) {
            const current = this.player.currentAudioElement;
            const handlers = ['_timeupdateHandler', '_endedHandler', '_loadedmetadataHandler', '_errorHandler'];
            handlers.forEach(handler => {
                if (current[handler]) {
                    const eventType = handler.replace('Handler', '').replace('_', '');
                    current.removeEventListener(eventType, current[handler]);
                }
            });
            try { current.pause(); } catch (e) {}
        }

        // Adopt
        const existing = this.player.currentAudioElement;

        if (existing && existing !== audio) {
            // Reuse the existing element to maintain the iOS audio session established
            // by the original user gesture. Swap its src instead of replacing the element.
            const srcToUse = audio.src || audio.currentSrc || audioUrl;

            // Release the hydrated element — we're taking its URL, not the element itself.
            try { audio.pause(); } catch (e) {}
            try { audio.src = ''; audio.load(); } catch (e) {}

            if (!srcToUse) {
                return false;
            }

            try {
                existing.src = srcToUse;
                existing.currentTime = 0;
                existing.playbackRate = this.player.playbackSpeed;
                // Re-attach listeners before load() so no loadedmetadata events are missed.
                this.player.playback.controls.setupAudioEventListeners();
                existing.load();
            } catch (e) {
                return false;
            }

            return true;
        }

        // No existing element — adopt the hydrated one directly (first chunk or reset).
        this.player.currentAudioElement = audio;
        try {
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
        } catch (e) {}

        const hasSrc = !!(audio.currentSrc || audio.src);
        if (!hasSrc && audioUrl) {
            try {
                audio.src = audioUrl;
                audio.load();
            } catch (e) {
                return false;
            }
        }

        // Ensure metadata is ready (prevents readyState=0 transition weirdness)
        try {
            if (audio.readyState < 1 || !Number.isFinite(audio.duration) || audio.duration === Infinity) {
                await new Promise((resolve, reject) => {
                    let done = false;
                    const timeoutMs = 2000;
                    let t;

                    const onMeta = () => {
                        if (done) return;
                        done = true;
                        cleanup();
                        resolve();
                    };

                    const onErr = (e) => {
                        if (done) return;
                        done = true;
                        cleanup();
                        reject(e);
                    };

                    const onTimeout = () => {
                        if (done) return;
                        done = true;
                        cleanup();
                        // Not fatal: resolve to allow play attempt, but we have reduced odds of error
                        resolve();
                    };

                    const startTimer = (ms = timeoutMs) => {
                        t = setTimeout(onTimeout, ms);
                    };

                    const cleanup = () => {
                        audio.removeEventListener('loadedmetadata', onMeta);
                        audio.removeEventListener('error', onErr);
                        clearTimeout(t);
                    };

                    // Always start the timer immediately. Use a longer window for background/locked contexts
                    // where media events are throttled by the browser/OS.
                    startTimer(document.hidden ? 6000 : 2000);

                    audio.addEventListener('loadedmetadata', onMeta, { once: true });
                    audio.addEventListener('error', onErr, { once: true });

                    // Kick load if needed
                    try { audio.load(); } catch (e) {}
                });
            }
        } catch (e) {
            return false;
        }

        // Apply settings + listeners
        audio.playbackRate = this.player.playbackSpeed;
        this.player.playback.controls.setupAudioEventListeners();

        return true;
    }
    
    async initializeAudio(audioUrl) {
        try {
            if (this.player.currentAudioElement) {
                const handlers = ['_timeupdateHandler', '_endedHandler', '_loadedmetadataHandler', '_errorHandler'];
                handlers.forEach(handler => {
                    if (this.player.currentAudioElement[handler]) {
                        const eventType = handler.replace('Handler', '').replace('_', '');
                        this.player.currentAudioElement.removeEventListener(eventType, this.player.currentAudioElement[handler]);
                    }
                });
                this.player.currentAudioElement = null;
            }

            const audio = new Audio();
            audio.crossOrigin = 'anonymous';
            audio.preload = 'auto';
            this.player.currentAudioElement = audio;
            audio.playbackRate = this.player.playbackSpeed;

            await new Promise((resolve, reject) => {
                const onLoadedMetadata = () => {
                    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
                    audio.removeEventListener('error', onError);
                    resolve();
                };
                const onError = () => {
                    audio.removeEventListener('loadedmetadata', onLoadedMetadata);
                    audio.removeEventListener('error', onError);
                    const mediaError = typeof this.player.formatMediaElementError === 'function'
                        ? this.player.formatMediaElementError(audio, { label: 'initialize-audio' })
                        : (() => {
                            const fallback = new Error('[DataCore] Audio element failed to load.');
                            console.error('[DataCore] initializeAudio failed', fallback);
                            return fallback;
                        })();
                    reject(mediaError);
                };
                audio.addEventListener('loadedmetadata', onLoadedMetadata);
                audio.addEventListener('error', onError);
                audio.src = audioUrl;
                audio.load();
            });

            this.player.playback.controls.setupAudioEventListeners();
        } catch (error) {
            throw error;
        }
    }
}
