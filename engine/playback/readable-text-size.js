(function initializeArtReaderReadableTextSize() {
    if (typeof window === 'undefined') {
        throw new Error('[ReadableTextSize] window is required.');
    }

    const PAGEVIEW_REBALANCE_DELAY_MS = 120;

    function readRootPixelVariable(player, propertyName) {
        if (typeof player.readRootPixelVariable === 'function') {
            return player.readRootPixelVariable(propertyName);
        }
        if (typeof propertyName !== 'string' || !propertyName.startsWith('--')) {
            throw new Error('[ReadableTextSize] readRootPixelVariable requires a CSS custom property name.');
        }
        const rawValue = getComputedStyle(document.documentElement).getPropertyValue(propertyName).trim();
        const parsedValue = Number.parseFloat(rawValue);
        if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
            throw new Error(`[ReadableTextSize] ${propertyName} must resolve to a positive pixel value.`);
        }
        return parsedValue;
    }

    function syncFullChunkScrollableState(player) {
        const textContent = player.elements?.fullChunkDisplay?.querySelector('.text-content');
        if (!textContent) {
            return;
        }
        requestAnimationFrame(() => {
            if (typeof player.input?.dataDisplay?.updateFullChunkScrollableState === 'function') {
                player.input.dataDisplay.updateFullChunkScrollableState(textContent);
            }
        });
    }

    function clearDeferredPageViewResizeRebalance(player) {
        if (player._pageViewResizeRebalanceTimer) {
            clearTimeout(player._pageViewResizeRebalanceTimer);
            player._pageViewResizeRebalanceTimer = null;
        }
    }

    function scheduleDeferredPageViewResizeRebalance(player) {
        clearDeferredPageViewResizeRebalance(player);
        player._pageViewResizeRebalanceTimer = setTimeout(() => {
            player._pageViewResizeRebalanceTimer = null;
            if (player.activeView !== 'pageview') {
                return;
            }
            if (!Number.isInteger(player.currentPageIndex) || player.currentPageIndex < 0) {
                return;
            }
            const currentSize = readRootPixelVariable(player, '--pageviewmode-font-size');
            if (typeof player.input?.dataDisplay?.snapCurrentPageViewFontSizeToFit === 'function') {
                player.input.dataDisplay.snapCurrentPageViewFontSizeToFit(player.currentPageIndex, currentSize);
            }
        }, PAGEVIEW_REBALANCE_DELAY_MS);
    }

    function resolveReturnsTarget(player) {
        if (player.activeView === 'fullchunk') {
            return Object.freeze({
                cssProperty: '--fullchunkdisplay-font-size',
                minProperty: '--fullchunkdisplay-font-size-min',
                maxProperty: '--fullchunkdisplay-font-size-max',
                preferenceKey: 'userNotPlayingFontSize',
                onAfterResize: () => syncFullChunkScrollableState(player)
            });
        }
        if (player.activeView === 'pageview') {
            return Object.freeze({
                cssProperty: '--pageviewmode-font-size',
                minProperty: '--pageviewmode-font-size-min',
                maxProperty: '--pageviewmode-font-size-max',
                preferenceKey: 'userPageViewModeFontSize',
                allowLiveResizeBeyondMax: true,
                onAfterResize: () => scheduleDeferredPageViewResizeRebalance(player)
            });
        }
        return null;
    }

    function canAdjustReturns(player) {
        return resolveReturnsTarget(player) !== null;
    }

    function adjust(player, delta) {
        if (!Number.isInteger(delta) || delta === 0) {
            throw new Error('[ReadableTextSize] adjust(delta) requires a non-zero integer delta.');
        }

        const target = resolveReturnsTarget(player);
        if (!target) {
            return false;
        }

        const currentSize = readRootPixelVariable(player, target.cssProperty);
        const minSize = readRootPixelVariable(player, target.minProperty);
        const maxSize = readRootPixelVariable(player, target.maxProperty);
        const nextSize = target.allowLiveResizeBeyondMax
            ? Math.max(minSize, currentSize + delta)
            : Math.max(minSize, Math.min(maxSize, currentSize + delta));

        if (nextSize === currentSize) {
            return false;
        }

        document.documentElement.style.setProperty(target.cssProperty, `${nextSize}px`);
        player[target.preferenceKey] = nextSize;

        if (typeof target.onAfterResize === 'function') {
            target.onAfterResize();
        }

        return true;
    }

    function install(player) {
        if (!player || typeof player !== 'object') {
            throw new Error('[ReadableTextSize] install() requires a player.');
        }
        player.canAdjustReadableTextSize = () => canAdjustReturns(player);
        player.adjustReadableTextSize = (delta) => adjust(player, delta);
        player.syncFullChunkScrollableState = () => syncFullChunkScrollableState(player);
    }

    window.ArtReaderReadableTextSize = Object.freeze({
        resolveReturnsTarget,
        canAdjustReturns,
        adjust,
        install
    });
})();
