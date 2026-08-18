(function initializeArtReaderPageTimes() {
    if (typeof window === 'undefined') {
        throw new Error('[PageTimes] window is required.');
    }

    function getPageByArrayIndex(player, pageIndex) {
        const pages = player.pages;
        if (!Array.isArray(pages) || pages.length === 0) {
            throw new Error('[PageTimes] pages are required.');
        }
        if (!Number.isInteger(pageIndex)) {
            throw new Error(`[PageTimes] pageIndex must be an integer. Received: ${pageIndex}`);
        }
        if (pageIndex < 0 || pageIndex >= pages.length) {
            throw new Error(`[PageTimes] pageIndex ${pageIndex} is out of range.`);
        }
        return pages[pageIndex];
    }

    function getPagePlaybackStartTime(player, pageIndex) {
        const page = getPageByArrayIndex(player, pageIndex);
        if (!Number.isFinite(page?.start)) {
            throw new Error(`[PageTimes] Page ${pageIndex} is missing a finite start time.`);
        }
        return page.start;
    }

    function getPageWordStartTime(player, pageIndex) {
        const page = getPageByArrayIndex(player, pageIndex);
        const firstWordStart = page?.words?.[0]?.start;
        if (Number.isFinite(firstWordStart)) {
            return firstWordStart;
        }
        return getPagePlaybackStartTime(player, pageIndex);
    }

    function install(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[PageTimes] install() requires a player.');
        }
        player.getPageByArrayIndex = (pageIndex) => getPageByArrayIndex(player, pageIndex);
        player.getPagePlaybackStartTime = (pageIndex) => getPagePlaybackStartTime(player, pageIndex);
        player.getPageWordStartTime = (pageIndex) => getPageWordStartTime(player, pageIndex);
    }

    window.ArtReaderPageTimes = Object.freeze({
        getPageByArrayIndex,
        getPagePlaybackStartTime,
        getPageWordStartTime,
        install
    });
})();
