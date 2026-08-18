(function initializeArtReaderReturnsOverlayActions() {
    if (typeof window === 'undefined') {
        throw new Error('[ReturnsOverlayActions] window is required.');
    }

    function resolveHeroAction({ mode, isPlaying }) {
        if (mode === 'fullchunk') {
            return {
                action: 'play',
                label: 'Play',
                stateClass: 'play-state',
                disabled: false
            };
        }
        if (mode === 'pageview') {
            const action = isPlaying ? 'pause' : 'play';
            return {
                action,
                label: isPlaying ? 'Pause' : 'Play',
                stateClass: isPlaying ? 'pause-state' : 'play-state',
                disabled: false
            };
        }
        return null;
    }

    function getActionVisibility(mode, { isSharedShell = false } = {}) {
        const returnsMode = mode === 'fullchunk' || mode === 'pageview';
        if (isSharedShell) {
            return {
                generateBtn: true,
                loadBtn: false,
                saveBtn: false,
                prevPageBtn: returnsMode,
                exportBtn: mode !== 'input' && mode !== 'loading',
                nextPageBtn: returnsMode,
                resetBtn: false
            };
        }

        return {
            generateBtn: true,
            loadBtn: mode === 'input',
            saveBtn: mode !== 'input',
            prevPageBtn: returnsMode,
            exportBtn: mode !== 'input',
            nextPageBtn: returnsMode,
            resetBtn: true
        };
    }

    window.ArtReaderReturnsOverlayActions = Object.freeze({
        resolveHeroAction,
        getActionVisibility
    });
})();
