(function initializeArtReaderReturnsOverlay() {
    if (typeof window === 'undefined') {
        throw new Error('[ReturnsOverlay] window is required.');
    }

    function resolveIncludesTouchGestures(options) {
        if (options && typeof options.includesTouchGestures === 'boolean') {
            return options.includesTouchGestures;
        }
        const variant = window.ArtReaderShellVariant;
        if (variant && typeof variant.includesTouchGestures === 'boolean') {
            return variant.includesTouchGestures;
        }
        return false;
    }

    function resolveActiveView(options) {
        if (options && typeof options.activeView === 'string' && options.activeView.trim().length > 0) {
            return options.activeView.trim();
        }
        return 'input';
    }

    function buildOverlayHtml({ includesTouchGestures, activeView }) {
        return `
    <div id="builtin-overlay" class="builtin-overlay" data-active-view="${activeView}">
        <div class="overlay-header">
            <div class="header-left" id="overlayTitleBar">
                <div class="overlay-title-static" id="overlayTitleStatic">ArT Reader</div>
            </div>
            <div class="header-center">
                <input type="text" class="header-title-readout" id="headerTitleReadout" aria-label="Title for this ArT" autocomplete="off">
            </div>
            <div class="header-right">
                <button type="button" id="loadBtn" class="header-action-btn" title="Load" aria-label="Load">
                    <span aria-hidden="true">📁</span>
                </button>
                <div class="speed-display" id="speedDisplay">95%</div>
                <button type="button" id="resetBtn" class="header-action-btn" disabled title="Clear and Reset" aria-label="Clear and Reset" data-tab-excluded>
                    <span aria-hidden="true">🗑</span>
                </button>
            </div>
        </div>

        <div class="overlay-progress-row" aria-label="Chunk navigation">
            <div class="progress-section" id="progressBar"></div>
            <label class="loading-title-row is-empty" id="loadingTitleRow" for="overlayTitleInput">
                <span class="overlay-title-placeholder" id="overlayTitlePlaceholder" aria-hidden="true"></span>
                <span class="overlay-title-display" id="overlayTitleDisplay" aria-hidden="true"></span>
                <input
                    type="text"
                    id="overlayTitleInput"
                    class="overlay-title-input"
                    aria-label="Title for this ArT"
                    autocomplete="off"
                >
                <span class="loading-title-block-cursor" aria-hidden="true"></span>
            </label>
            <p class="title-row-hint" id="titleRowHint" aria-live="polite">Enter a name for this ArT</p>
        </div>

        <div class="overlay-content">
            <div class="overlay-body">
                <div class="overlay-main">
                    <div class="view-panel loading-view" id="loadingView" hidden>
                        <div class="loading-interface timer-shell--segment-line" id="loadingInterface" data-segment-tone="white" data-segment-opacity="50">
                            <div class="timer-segment-line-row" aria-live="polite">
                                <div class="timer-segments timer-segments--line" data-role="segments"></div>
                                <div class="timer-segment-line-passage">
                                    <div class="timer-segment-line-countdown">
                                        <div class="timer-flip timer-flip--segment-line">
                                            <span class="timer-flip-digit timer-flip-digit--tickflip" data-role="flip-tens">2</span>
                                            <span class="timer-flip-digit timer-flip-digit--tickflip" data-role="flip-ones">6</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="timer-segment-line-emerge" aria-hidden="true">
                                    <span class="timer-segment-line-sentence-text" data-role="segment-line-sentence"></span>
                                </div>
                            </div>
                            <label class="loading-autoplay-toggle" for="loadingAutoPlayToggle">
                                <input type="checkbox" class="loading-autoplay-checkbox" id="loadingAutoPlayToggle">
                                <span class="loading-autoplay-toggle-label">Auto-play when ready</span>
                            </label>
                            <div hidden aria-hidden="true">
                                <div id="loadingLiveBadge"></div>
                                <div id="loadingEventAge"></div>
                                <div id="loadingStageIndex"></div>
                                <div id="stepsDisplay"></div>
                                <div id="loadingStageDetail"></div>
                                <div id="loadingConfidenceMessage"></div>
                                <div id="loadingProgressTrack"></div>
                            </div>
                        </div>
                    </div>

                    <div class="view-panel fullchunk-view" id="fullChunkView" hidden>
                        <div id="fullChunkDisplay"></div>
                    </div>

                    <div class="view-panel page-view" id="pageView" hidden>
                        <div id="pageViewDisplay"></div>
                    </div>
                    ${includesTouchGestures ? '<div id="pageViewGestureLayer" class="pageview-gesture-layer" aria-hidden="true"></div>' : ''}
                </div>

                <div class="overlay-actions" id="overlayActions">
                    <button type="button" class="generate-btn overlay-primary-action generate-state" id="generateBtn">
                        <span class="btn-label">Paste and Generate</span>
                    </button>
                    <div id="pageviewPlayHitbox" aria-hidden="true"></div>
                    <!-- Row 2 (post-generation): Save · MP3 · ← → -->
                    <div class="overlay-actions-row" id="overlayActionsSecondaryRow">
                        <div class="action-group" id="actionGroupPrimary">
                            <button type="button" id="saveBtn" class="title-action-btn" disabled hidden title="Save session ZIP" aria-label="Save session ZIP" data-tab-excluded>
                                <span class="btn-icon" aria-hidden="true">💾</span>
                                <span class="btn-label">Save</span>
                            </button>
                            <button type="button" id="exportBtn" class="title-action-btn" disabled hidden title="Save MP3" data-tab-excluded>
                                <span class="btn-icon" aria-hidden="true">↑</span>
                                <span class="btn-label">MP3</span>
                            </button>
                        </div>
                        <div class="action-group action-group--nav-pair" id="actionGroupNav">
                            <button type="button" id="prevPageBtn" class="title-action-btn nav-pair-btn nav-pair-btn--prev" disabled hidden title="Previous page" aria-label="Previous page" data-tab-excluded>
                                <span class="btn-icon" aria-hidden="true">←</span>
                            </button>
                            <button type="button" id="nextPageBtn" class="title-action-btn nav-pair-btn nav-pair-btn--next" disabled hidden title="Next page" aria-label="Next page" data-tab-excluded>
                                <span class="btn-icon" aria-hidden="true">→</span>
                            </button>
                        </div>
                    </div>
                    ${includesTouchGestures ? '<div id="pageNavDots" class="page-nav-dots" hidden aria-hidden="true"></div>' : ''}
                </div>
            </div>
        </div>
        <div id="inputOptionBackdrop" hidden></div>
        <div id="consoleErrorNotice" class="console-error-notice" hidden role="alert" aria-live="assertive"></div>
    </div>`;
    }

    function mount(container, options) {
        if (!container) {
            throw new Error('[ReturnsOverlay] mount() requires a container node.');
        }

        const includesTouchGestures = resolveIncludesTouchGestures(options);
        const activeView = resolveActiveView(options);
        const wrap = document.createElement('div');
        wrap.innerHTML = buildOverlayHtml({ includesTouchGestures, activeView }).trim();
        const overlay = wrap.firstElementChild;
        if (!overlay || overlay.id !== 'builtin-overlay') {
            throw new Error('[ReturnsOverlay] mount() failed to build #builtin-overlay.');
        }

        container.appendChild(overlay);

        const overlayMain = overlay.querySelector('.overlay-main');
        if (!overlayMain) {
            throw new Error('[ReturnsOverlay] mount() failed to find .overlay-main.');
        }

        return Object.freeze({
            overlay,
            overlayMain
        });
    }

    window.ArtReaderReturnsOverlay = Object.freeze({
        mount
    });
})();
