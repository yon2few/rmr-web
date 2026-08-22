// Shared RMR returns host. Do not load engine/index.js.
// Slideshow URLs from AGENT_brand-spec-for-build.md.

const BRAND_SLIDESHOW_URLS = [
    'https://images.unsplash.com/photo-1557683316-973673baf926?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1511447333015-45b65e60f6d5?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1487147264018-f937fba0c817?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1533120760634-4a3717c13b2c?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=1920&h=1080&fit=crop',
    'https://images.unsplash.com/photo-1561998396-e4a4d9b4c8a5?w=1920&h=1080&fit=crop'
];

(function setupSlideshow() {
    const root = document.getElementById('slideshow');
    if (!root) return;
    let current = 0;
    window.advanceSlideForAudioPart = function advanceSlideForAudioPart() {
        current = (current + 1) % BRAND_SLIDESHOW_URLS.length;
        let slide = root.querySelector(`[data-index="${current}"]`);
        if (!slide) {
            slide = document.createElement('div');
            slide.className = 'slide';
            slide.dataset.index = String(current);
            slide.style.backgroundImage = `url('${BRAND_SLIDESHOW_URLS[current]}')`;
            if (current !== 0) {
                const dim = document.createElement('div');
                dim.className = 'slide-dim';
                slide.appendChild(dim);
            }
            root.appendChild(slide);
        }
        root.querySelectorAll('.slide').forEach((el) => el.classList.toggle('active', el === slide));
    };
    window.resetSlideshow = function resetSlideshow() {
        current = 0;
        root.querySelectorAll('.slide').forEach((el) => {
            el.classList.toggle('active', el.dataset.index === '0');
        });
    };
}());

function createHostPlayer({ enableMp3Export } = {}) {
    if (typeof enableMp3Export !== 'boolean') {
        throw new Error('[HostReturns] createHostPlayer requires a boolean enableMp3Export option.');
    }
    if (!window.ArtReaderReturnsOverlay || typeof window.ArtReaderReturnsOverlay.mount !== 'function') {
        throw new Error('[HostReturns] engine/overlay/markup.js did not load.');
    }
    if (!window.ArtReaderShellRuntime) {
        throw new Error('[HostReturns] engine/overlay/shell-runtime.js did not load.');
    }
    if (!window.ArtReaderReturnsOverlayActions) {
        throw new Error('[HostReturns] engine/overlay/returns-actions.js did not load.');
    }

    const screenInput = document.getElementById('screen-input');
    const overlayHost = document.getElementById('returns-overlay-host');
    const inputOverlay = document.getElementById('input-overlay');
    const footerRow = document.querySelector('.footer-row');
    if (!overlayHost) {
        throw new Error('[HostReturns] Missing #returns-overlay-host.');
    }

    const { overlay } = window.ArtReaderReturnsOverlay.mount(overlayHost, {
        includesTouchGestures: false,
        activeView: 'loading'
    });

    const fullChunkView = document.getElementById('fullChunkView');
    const pageView = document.getElementById('pageView');
    const loadingView = document.getElementById('loadingView');
    const pageViewDisplay = document.getElementById('pageViewDisplay');
    const fullChunkDisplay = document.getElementById('fullChunkDisplay');
    const generateBtn = document.getElementById('generateBtn');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');
    const loadBtn = document.getElementById('loadBtn');
    const saveBtn = document.getElementById('saveBtn');
    const exportBtn = document.getElementById('exportBtn');
    const resetBtn = document.getElementById('resetBtn');
    const overlayTitleStatic = document.getElementById('overlayTitleStatic');
    const headerTitleReadout = document.getElementById('headerTitleReadout');
    const overlayHeader = overlay.querySelector('.overlay-header');
    const headerLeft = overlay.querySelector('.header-left');
    let overlayTitleWrap = document.getElementById('rmrOverlayTitleWrap');
    if (headerLeft && !overlayTitleWrap) {
        overlayTitleWrap = document.createElement('div');
        overlayTitleWrap.id = 'rmrOverlayTitleWrap';
        overlayTitleWrap.className = 'rmr-overlay-title';
        overlayTitleWrap.setAttribute('aria-hidden', 'true');
        headerLeft.appendChild(overlayTitleWrap);
    }

    let audioChunks = [];
    let currentChunkIndex = 0;
    let currentPageIndex = 0;
    let currentAudioElement = null;
    let streamJobStartedFlag = false;
    let streamTotalChunks = null;
    let playbackUnlocked = false;
    let playbackSpeedValue = 0.95;
    let onReset = null;
    let requestTitle = '';
    let allChunksReady = false;

    function showHostScreen(name) {
        const overlayOpen = name === 'loading' || name === 'fullchunk' || name === 'pageview';
        screenInput.style.display = name === 'input' ? 'flex' : 'none';
        if (inputOverlay) inputOverlay.hidden = overlayOpen;
        if (footerRow) footerRow.hidden = overlayOpen;
        const panel = document.getElementById('panel');
        if (panel) panel.classList.toggle('is-returns-open', overlayOpen);
        overlayHost.classList.toggle('is-open', overlayOpen);
    }

    function setThreadChrome({ subreddit, title } = {}) {
        const sub = typeof subreddit === 'string' ? subreddit.trim() : '';
        const nextTitle = typeof title === 'string' ? title.trim() : '';
        requestTitle = nextTitle;
        if (overlayTitleStatic) {
            overlayTitleStatic.textContent = sub || 'ArT Reader';
        }
        if (headerTitleReadout) {
            headerTitleReadout.value = nextTitle;
            headerTitleReadout.readOnly = true;
        }
        if (overlayTitleWrap) {
            overlayTitleWrap.textContent = nextTitle;
            overlayTitleWrap.hidden = !nextTitle;
        }
        if (overlayHeader) {
            overlayHeader.classList.toggle('title-committed', !!nextTitle);
            overlayHeader.classList.toggle('has-filled-title', !!nextTitle);
        }
        const titleInput = document.getElementById('overlayTitleInput');
        if (titleInput) titleInput.value = nextTitle;
    }

    function endBlockingGenerationPhase() {
        // Match Engine host/audio-input-cloudrun.js: once the first chunk can
        // play, pause/resume/space must work even if later chunks are still streaming.
        player.isGenerating = false;
        if (player.activeView === 'input') return;
        player.syncOverlayActionState({
            mode: player.activeView,
            isPlaying: player.getIsPlaying(),
            hasAudio: player.computeHasAudio(),
            isGenerating: false
        });
    }

    const player = {
        get audioChunks() { return audioChunks; },
        set audioChunks(v) { audioChunks = Array.isArray(v) ? v : []; },
        get currentChunkIndex() { return currentChunkIndex; },
        set currentChunkIndex(v) { currentChunkIndex = v; },
        get currentPageIndex() { return currentPageIndex; },
        set currentPageIndex(v) { currentPageIndex = v; },
        _pages: [],
        get pages() { return this._pages; },
        set pages(v) { this._pages = Array.isArray(v) ? v : []; },
        activeView: 'input',
        shellVariant: Object.freeze({ includesTouchGestures: false }),
        audioDecodeRetriedChunks: new Set(),
        setActiveView(name) {
            if (name === 'input') {
                this.activeView = 'input';
                showHostScreen('input');
                return;
            }
            showHostScreen(name);
            if (this.shellRuntime) {
                this.shellRuntime.setActiveView(name);
            } else {
                this.activeView = name;
            }
        },
        elements: {
            fullChunkDisplay,
            pageViewDisplay,
            generateBtn,
            prevPageBtn,
            nextPageBtn,
            loadBtn,
            saveBtn,
            exportBtn,
            resetBtn,
            builtinOverlay: overlay
        },
        get currentAudioElement() { return currentAudioElement; },
        set currentAudioElement(v) { currentAudioElement = v; },
        get playbackSpeed() { return playbackSpeedValue; },
        set playbackSpeed(v) { playbackSpeedValue = v; },
        updateHighlightColor: () => {},
        selectedWordStartTime: undefined,
        selectedPageIndex: null,
        selectedPageStartTime: null,
        pendingPageSelectionForPlay: false,
        renderedChunkIndex: null,
        renderedPageIndex: null,
        pendingPageTransitionPromise: null,
        pendingAutoResumeChunkIndex: null,
        pendingChunkGapMetric: null,
        isTransitioningChunks: false,
        lastDiagnostic: null,
        sessionId: 'rmr-scratch',
        get streamJobStarted() { return streamJobStartedFlag; },
        set streamJobStarted(v) { streamJobStartedFlag = !!v; },
        get streamTotalChunks() { return streamTotalChunks; },
        set streamTotalChunks(v) { streamTotalChunks = v; },
        get totalChunks() { return streamTotalChunks; },
        showStatus(message) {
            const notice = document.getElementById('consoleErrorNotice');
            if (!notice) return;
            notice.textContent = message || '';
            notice.hidden = !message;
        },
        clearConsoleErrorNotice() { this.showStatus(''); },
        getIsPlaying() {
            return !!(currentAudioElement && !currentAudioElement.paused);
        },
        computeHasAudio() {
            if (currentAudioElement && typeof currentAudioElement.src === 'string' && currentAudioElement.src) {
                return true;
            }
            return Array.isArray(audioChunks) && audioChunks.some(Boolean);
        },
        computeHasSavableState() {
            return enableMp3Export && this.computeHasCompleteLocalSession();
        },
        getRequestTitle() { return requestTitle; },
        requireEffectiveRequestTitle() {
            const title = requestTitle.trim();
            if (!title) {
                throw new Error('A title could not be derived because the input text is empty.');
            }
            return title;
        },
        buildFileBaseName() {
            const title = this.requireEffectiveRequestTitle();
            const sanitizedTitle = title
                .replace(/[\/\\?%*:|"<>]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!sanitizedTitle) {
                throw new Error('Title does not contain any valid filename characters.');
            }
            return sanitizedTitle;
        },
        setAllChunksReady(isReady) {
            allChunksReady = isReady === true;
        },
        markSubmissionReady() {
            this.setAllChunksReady(true);
            if (typeof this.syncOverlayActionState === 'function') {
                this.syncOverlayActionState({ isGenerating: false });
            }
        },
        computeHasCompleteLocalSession() {
            return enableMp3Export &&
                allChunksReady === true &&
                this.computeHasAudio() &&
                this.localAudio &&
                this.localAudio.hasCompleteLocalAudio();
        },
        computeCanReset() { return true; },
        resolveCurrentPageNavIndex() {
            const pages = this.pages;
            if (!Array.isArray(pages) || pages.length === 0) return null;
            if (this.activeView === 'fullchunk') {
                if (this.controls && typeof this.controls.resolveFullChunkPlayPageIndex === 'function') {
                    return this.controls.resolveFullChunkPlayPageIndex();
                }
                let pageIndex = this.selectedPageIndex;
                if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
                    pageIndex = Number.isInteger(this.currentPageIndex) ? this.currentPageIndex : 0;
                }
                return pageIndex;
            }
            if (this.activeView === 'pageview') {
                const pageIndex = this.currentPageIndex;
                if (Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pages.length) {
                    return pageIndex;
                }
                return 0;
            }
            return null;
        },
        readRootPixelVariable(propertyName) {
            if (typeof propertyName !== 'string' || !propertyName.startsWith('--')) {
                throw new Error('[HostReturns] readRootPixelVariable requires a CSS custom property name.');
            }
            const raw = window.getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
            const px = parseFloat(raw);
            if (!Number.isFinite(px)) {
                throw new Error(`[HostReturns] ${propertyName} must resolve to a pixel length.`);
            }
            return px;
        },
        isGenerating: false,
        waitForAudioPlaybackReady(audio, context = {}) {
            if (!(audio instanceof HTMLMediaElement)) {
                this.raiseSubsystemFailure('playback', new Error('HTMLMediaElement is required.'), context);
            }
            if (document.hidden) return Promise.resolve(audio);
            if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(audio);
            return new Promise((resolve, reject) => {
                const onReady = () => { cleanup(); resolve(audio); };
                const onError = () => {
                    cleanup();
                    const code = audio.error ? audio.error.code : 'unknown';
                    reject(this.captureSubsystemFailure(
                        'playback',
                        new Error(`Audio element failed before playback readiness (MediaError code ${code}).`),
                        context
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
            });
        },
        captureSubsystemFailure(stage, error, context) {
            console.error(`[RMR][${stage}]`, context, error);
            return error;
        },
        raiseSubsystemFailure(stage, error, context) {
            throw this.captureSubsystemFailure(stage, error, context);
        },
        input: {}
    };

    player.localAudio = null;
    player.mp3Export = null;
    if (enableMp3Export) {
        if (typeof LocalAudioArtifactStore !== 'function') {
            throw new Error('[HostReturns] MP3 export requires local-audio-artifact-store.js.');
        }
        if (typeof Mp3ExportService !== 'function') {
            throw new Error('[HostReturns] MP3 export requires mp3-export-service.js.');
        }
        if (!window.lamejs || typeof window.lamejs.Mp3Encoder !== 'function') {
            throw new Error('[HostReturns] MP3 export requires vendor/lame.min.js.');
        }
        player.localAudio = new LocalAudioArtifactStore(player);
        player.mp3Export = new Mp3ExportService(player);
    }

    if (!window.ArtReaderPageTimes || !window.ArtReaderReadableTextSize) {
        throw new Error('[HostReturns] page-times.js and readable-text-size.js are required.');
    }
    window.ArtReaderPageTimes.install(player);
    window.ArtReaderReadableTextSize.install(player);

    const shellRuntime = window.ArtReaderShellRuntime.create({
        controllerName: 'RmrHostReturns',
        builtinOverlay: overlay,
        viewNodes: {
            loading: loadingView,
            fullchunk: fullChunkView,
            pageview: pageView
        },
        actionNodes: {
            generateBtn,
            loadBtn,
            saveBtn,
            prevPageBtn,
            exportBtn,
            nextPageBtn,
            resetBtn
        },
        validModes: ['loading', 'fullchunk', 'pageview'],
        delegate: {
            getCurrentMode: () => player.activeView,
            setCurrentMode: (mode) => {
                player.activeView = mode;
            },
            getIsPlaying: () => player.getIsPlaying(),
            getIsGenerating: () => player.isGenerating,
            getHasAudio: () => player.computeHasAudio(),
            getCanSave: () => false,
            getCanExport: () => enableMp3Export && player.computeHasCompleteLocalSession(),
            getCanShare: () => false,
            getCanReset: () => true,
            getOverlayActionVisibility: (mode) => {
                const visibility = window.ArtReaderReturnsOverlayActions.getActionVisibility(mode);
                visibility.loadBtn = false;
                visibility.saveBtn = false;
                visibility.exportBtn = enableMp3Export && (mode === 'fullchunk' || mode === 'pageview');
                visibility.resetBtn = true;
                visibility.generateBtn = true;
                visibility.prevPageBtn = mode === 'fullchunk' || mode === 'pageview';
                visibility.nextPageBtn = visibility.prevPageBtn;
                return visibility;
            },
            getButtonDisabledState: (state) => {
                const hasAudioReady = state.hasAudio && !state.isGenerating;
                const pageCount = Array.isArray(player.pages) ? player.pages.length : 0;
                const pageIndex = player.resolveCurrentPageNavIndex();
                const chunkIndex = player.currentChunkIndex;
                const chunkCount = player.totalChunks;

                let prevDisabled = true;
                let nextDisabled = true;
                if (state.mode === 'fullchunk' && hasAudioReady && chunkCount > 1) {
                    prevDisabled = !(Number.isInteger(chunkIndex) && chunkIndex > 0);
                    nextDisabled = !(Number.isInteger(chunkIndex) && chunkIndex < chunkCount - 1);
                } else if (state.mode === 'pageview' && hasAudioReady && pageCount > 1) {
                    prevDisabled = !(Number.isInteger(pageIndex) && pageIndex > 0);
                    nextDisabled = !(Number.isInteger(pageIndex) && pageIndex < pageCount - 1);
                }

                return {
                    loadBtn: true,
                    saveBtn: true,
                    exportBtn: !state.canExport || !!state.isGenerating,
                    prevPageBtn: prevDisabled,
                    nextPageBtn: nextDisabled,
                    resetBtn: !!state.isGenerating
                };
            },
            resolveHeroAction: (state) => {
                const returnsHero = window.ArtReaderReturnsOverlayActions.resolveHeroAction(state);
                if (returnsHero) return returnsHero;
                return {
                    action: 'loading',
                    label: 'Loading',
                    stateClass: 'loading-state',
                    disabled: true
                };
            }
        }
    });

    player.shellRuntime = shellRuntime;
    player.setOverlayActionState = (state = {}) => {
        if (state.mode === 'input') {
            showHostScreen('input');
            return;
        }
        if (state.mode) showHostScreen(state.mode);
        shellRuntime.setOverlayActionState(state);
    };
    player.syncOverlayActionState = (overrides = {}) => {
        if (player.activeView === 'input') return;
        shellRuntime.syncOverlayActionState(overrides);
    };

    const playbackAdapter = window.ArtReaderReaderPlaybackAdapter.createReaderPlaybackAdapter(player);
    player.playbackAdapter = playbackAdapter;
    player.captioning = playbackAdapter.engine;

    const dataCore = new AudioSystemInputDataCore(player);
    const dataDisplay = new AudioSystemInputDataDisplay(player);
    const playback = new AudioSystemPlayback(player);
    const chunkLoadCoordinator = new ChunkLoadCoordinator(player);
    const cloudrun = new window.ArtReaderHostCloudRun.HostInputCloudRun(player);

    player.input = {
        dataCore,
        dataDisplay,
        cloudrun,
        ui: { showStatus: (message) => player.showStatus(message) }
    };
    player.chunkLoadCoordinator = chunkLoadCoordinator;
    player.navigation = playback.navigation;
    player.progress = playback.progress;
    player.playback = playback;
    player.playback.progress = playback.progress;
    playback.initialize();
    player.controls = playback.controls;

    player.loading = new AudioSystemLoading(player);
    player.loading.isAutoPlayEnabled = () => false;
    player.loading.setAutoPlayEnabled = () => {};
    try {
        window.localStorage.setItem('artReader.autoPlayOnReady', 'off');
    } catch (error) {}
    const autoPlayToggle = document.getElementById('loadingAutoPlayToggle');
    if (autoPlayToggle) {
        autoPlayToggle.checked = false;
        autoPlayToggle.disabled = true;
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', () => {
            if (player.activeView === 'fullchunk' || player.activeView === 'pageview') {
                playback.handlePlaybackHeroAction();
            }
        });
    }
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            player.controls.triggerPageNav(-1);
        });
    }
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            player.controls.triggerPageNav(1);
        });
    }
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!enableMp3Export) {
                throw new Error('[HostReturns] MP3 export is disabled for this platform.');
            }
            if (!player.computeHasCompleteLocalSession()) return;
            if (!player.mp3Export || typeof player.mp3Export.exportMP3 !== 'function') {
                throw new Error('[HostReturns] MP3 export service is unavailable; #exportBtn cannot be handled.');
            }
            void player.mp3Export.exportMP3()
                .catch((error) => player.captureSubsystemFailure('export', error));
        });
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (player.isGenerating) return;
            if (typeof onReset === 'function') onReset();
        });
    }

    async function maybeUnlockFirstChunks() {
        if (playbackUnlocked) return;
        const n = streamTotalChunks;
        const need = n === 1 ? 1 : 2;
        for (let i = 0; i < need; i += 1) {
            if (!audioChunks[i]) return;
        }
        await chunkLoadCoordinator.initializeFirstChunk(0);
        playbackUnlocked = true;
        endBlockingGenerationPhase();
    }

    const api = {
        player,
        showHostScreen,
        setThreadChrome,
        set onReset(fn) { onReset = fn; },
        get onReset() { return onReset; },
        async resetReturns() {
            if (currentAudioElement && player.controls?.setupAudioEventListeners) {
                // AudioControls listeners detach via a fresh bind after src clear.
            }
            if (currentAudioElement) {
                try { currentAudioElement.pause(); } catch (e) {}
                try { currentAudioElement.src = ''; currentAudioElement.load(); } catch (e) {}
            }
            currentAudioElement = null;
            audioChunks = [];
            currentChunkIndex = 0;
            currentPageIndex = 0;
            streamJobStartedFlag = false;
            streamTotalChunks = null;
            playbackUnlocked = false;
            allChunksReady = false;
            player.isGenerating = false;
            if (enableMp3Export) player.localAudio.reset();
            player.pages = [];
            player.renderedChunkIndex = null;
            player.renderedPageIndex = null;
            player.audioDecodeRetriedChunks = new Set();
            playback.resetPageTurnQueue('reset');
            chunkLoadCoordinator.reset('reset-app');
            player.loading.hideLoadingInterface({ skipViewTransition: true });
            if (typeof window.resetSlideshow === 'function') window.resetSlideshow();
            setThreadChrome({ subreddit: '', title: '' });
            player.setActiveView('input');
        },
        async runGenerate({ endpoint, payload, signal }) {
            const transport = window.ArtReaderBackendTransport;
            if (!transport) {
                throw new Error('[HostReturns] shared-backend-transport.js did not load.');
            }

            if (currentAudioElement) {
                try { currentAudioElement.pause(); } catch (e) {}
                try { currentAudioElement.src = ''; currentAudioElement.load(); } catch (e) {}
            }
            currentAudioElement = null;
            audioChunks = [];
            streamTotalChunks = null;
            streamJobStartedFlag = false;
            playbackUnlocked = false;
            allChunksReady = false;
            if (enableMp3Export) player.localAudio.reset();
            currentChunkIndex = 0;
            currentPageIndex = 0;
            player.isGenerating = true;
            player.loading.showLoadingInterface();
            player.syncOverlayActionState({ mode: 'loading', isGenerating: true, isPlaying: false });
            await new Promise((resolve) => {
                requestAnimationFrame(() => {
                    setTimeout(resolve, 0);
                });
            });
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

            try {
                const stream = await transport.postJsonStream({ endpoint, payload });

                if (!stream || typeof stream.getReader !== 'function') {
                    throw new Error('Transform service did not return a readable stream.');
                }

                await transport.consumeNdjsonStream(stream, {
                    onJobStart: async (event) => {
                        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                        streamTotalChunks = event.totalChunks;
                        streamJobStartedFlag = true;
                        audioChunks = new Array(event.totalChunks).fill(null);
                        player.loading.handleSubmissionAccepted({ totalChunks: event.totalChunks });
                    },
                    onChunkReady: async (event) => {
                        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                        const prepared = dataCore.preparePagesData(event.chunk.pages || []);
                        const chunk = { ...event.chunk, pages: prepared, audioUrl: event.chunk.moduleAudioUrl || event.chunk.audioUrl };
                        audioChunks[event.chunkIndex] = chunk;
                        if (enableMp3Export) {
                            await player.localAudio.materializeChunkAudio(event.chunkIndex, chunk);
                        }
                        if (event.chunkIndex > 0) {
                            chunkLoadCoordinator.markChunkDelivered(event.chunkIndex);
                        }
                        if (!playbackUnlocked) {
                            const n = Number.isInteger(streamTotalChunks) ? streamTotalChunks : audioChunks.length;
                            player.loading.handleChunkReady({ chunkIndex: event.chunkIndex, totalChunks: n });
                        }
                        await maybeUnlockFirstChunks();
                    },
                    onComplete: async () => {
                        const n = Number.isInteger(streamTotalChunks) ? streamTotalChunks : audioChunks.length;
                        player.loading.handleSubmissionComplete({ totalChunks: n });
                        player.isGenerating = false;
                        await maybeUnlockFirstChunks();
                        if (!enableMp3Export || player.localAudio.hasCompleteLocalAudio()) {
                            player.markSubmissionReady();
                        }
                        if (player.activeView !== 'input') {
                            player.syncOverlayActionState({
                                mode: player.activeView,
                                isGenerating: false,
                                isPlaying: player.getIsPlaying()
                            });
                        }
                    }
                });
                player.isGenerating = false;
            } catch (error) {
                player.isGenerating = false;
                if (error?.name !== 'AbortError') {
                    player.loading.handleSubmissionFailed(error);
                }
                throw error;
            }
        }
    };

    showHostScreen('input');
    return api;
}

window.ArtReaderHostReturns = { createHostPlayer };
