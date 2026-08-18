// Reader Playback Adapter - the seam between AudioSystem and playback-module's
// host-agnostic CaptionOriginal contract. The only file that knows both
// "AudioSystem internals" and "playback-module public API."
import { CaptionOriginal } from '../playback-module/highlighting/engine.js';

export function createReaderPlaybackAdapter(player) {
    const engine = new CaptionOriginal({
        getAudioElement: () => player.currentAudioElement,
        getContainer: () => player.elements?.pageViewDisplay,
        getWords: () => {
            // Verbatim port of the engine's old getCurrentPageWords() body.
            if (player.pages && player.pages.length > 0) {
                const pageIndex = player.currentPageIndex || 0;
                if (pageIndex >= 0 && pageIndex < player.pages.length) {
                    const page = player.pages[pageIndex];
                    if (page && page.words && Array.isArray(page.words)) {
                        return page.words;
                    }
                }
            }
            return player.words;
        },
        onSeek: (startTime) => {
            // Verbatim port of ClickToSeekManager.handleWordClick's non-DOM
            // side effects (word-click half). Wired up when Phase 2 moves
            // word-click-to-seek into the engine itself.
            player.pendingPageSelectionForPlay = false;
            player.selectedPageIndex = null;
            player.selectedPageStartTime = null;
            player.selectedWordStartTime = startTime;
            if (player.currentAudioElement) {
                player.currentAudioElement.currentTime = startTime;
            }
            const textDisplay = player.elements?.pageViewDisplay;
            if (textDisplay?.classList.contains('playing') && player.currentAudioElement?.paused) {
                textDisplay.classList.remove('playing');
            }
        },
        onSpeakingPartAdvance: () => window.advanceSlideForAudioPart?.(),
    });

    // --- Page-level click-to-seek (FullChunk mode) ---
    // Verbatim port of ClickToSeekManager's page-click branch. This is a
    // host-only concept (FullChunk page-container DOM, progress-bar sync) the
    // engine has no reason to know about - RMR has no FullChunk view.

    function getSelectedPageSeekTime(pageIndex) {
        if (!Number.isInteger(pageIndex)) {
            throw new Error('[ReaderPlaybackAdapter] pageIndex must be an integer.');
        }
        if (typeof player.getPageWordStartTime !== 'function') {
            throw new Error('[ReaderPlaybackAdapter] player.getPageWordStartTime is required.');
        }
        return player.getPageWordStartTime(pageIndex);
    }

    function resolvePageArrayIndex(rawPageIndex) {
        if (!Number.isInteger(rawPageIndex) || rawPageIndex < 0) return null;
        const pages = player?.pages || [];
        if (!Array.isArray(pages) || pages.length === 0) return null;

        const mappedIndex = pages.findIndex((page, idx) => {
            const value = page?.pageIndex ?? page?.pageNumber ?? idx;
            return value === rawPageIndex;
        });
        if (mappedIndex >= 0) return mappedIndex;
        if (rawPageIndex < pages.length) return rawPageIndex;
        return null;
    }

    function setSelectedPage(pageContainer, pageIndex, startTime, container) {
        const textDisplay = container || player.elements.fullChunkDisplay;
        const allPages = textDisplay.querySelectorAll('.page-container');
        allPages.forEach((page) => page.classList.remove('selected'));

        pageContainer.classList.add('selected');
        player.currentPageIndex = pageIndex;
        player.selectedPageIndex = pageIndex;
        player.selectedPageStartTime = startTime;
        player.selectedWordStartTime = startTime;

        if (player.progress && typeof player.progress.syncProgressToSelectedPage === 'function') {
            player.progress.syncProgressToSelectedPage();
        }
    }

    function attachPageClickToSeek(container) {
        container.onclick = (e) => {
            const rawTarget = e.target;
            const target = rawTarget && rawTarget.nodeType === Node.TEXT_NODE
                ? rawTarget.parentElement
                : rawTarget;
            if (!target || typeof target.closest !== 'function') return;

            const pageContainer = target.closest('.page-container');
            if (!pageContainer) return;

            const rawPageIndex = parseInt(pageContainer.dataset.pageIndex, 10);
            const pageIndex = resolvePageArrayIndex(rawPageIndex);
            const startTime = Number.isInteger(pageIndex)
                ? getSelectedPageSeekTime(pageIndex)
                : NaN;

            if (!Number.isInteger(pageIndex) || !Number.isFinite(startTime)) return;

            setSelectedPage(pageContainer, pageIndex, startTime, container);
            player.pendingPageSelectionForPlay = true;

            if (container.classList.contains('playing') && player.currentAudioElement?.paused) {
                container.classList.remove('playing');
            }
        };
    }

    // resolvePageArrayIndex/getSelectedPageSeekTime/setSelectedPage are also
    // exposed directly (not just used internally by attachPageClickToSeek) -
    // audio-controls.js's resolveFullChunkPlayPageIndex() and
    // audio-input-display.js's post-render page-highlight logic both call
    // into these independently of the click handler itself.
    return { engine, attachPageClickToSeek, resolvePageArrayIndex, getSelectedPageSeekTime, setSelectedPage };
}

window.ArtReaderReaderPlaybackAdapter = { createReaderPlaybackAdapter };
