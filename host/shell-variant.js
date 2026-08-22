(function initializeArtReaderShellVariant() {
    if (typeof window === 'undefined') {
        throw new Error('[ShellVariant] window is required.');
    }

    const root = document.documentElement;
    if (!root) {
        throw new Error('[ShellVariant] document.documentElement is required.');
    }

    const variantName = typeof root.dataset.shellVariant === 'string'
        ? root.dataset.shellVariant.trim().toLowerCase()
        : '';

    const variants = Object.freeze({
        desktop: Object.freeze({
            includesMobileShellTitle: false,
            includesTouchGestures: false,
            mirrorsInputOverlayHeightToMobileToken: false,
            isSharedShell: false,
            modeAccess: null
        }),
        mobile: Object.freeze({
            includesMobileShellTitle: false,
            includesTouchGestures: true,
            mirrorsInputOverlayHeightToMobileToken: true,
            isSharedShell: false,
            modeAccess: null
        }),
        'shared-desktop': Object.freeze({
            includesMobileShellTitle: false,
            includesTouchGestures: false,
            mirrorsInputOverlayHeightToMobileToken: false,
            isSharedShell: true,
            modeAccess: null
        }),
        'shared-mobile': Object.freeze({
            includesMobileShellTitle: false,
            includesTouchGestures: true,
            mirrorsInputOverlayHeightToMobileToken: true,
            isSharedShell: true,
            modeAccess: null
        })
    });

    const shellVariant = variants[variantName];
    if (!shellVariant) {
        throw new Error(`[ShellVariant] Unsupported shell variant "${variantName}".`);
    }

    window.ArtReaderShellVariant = shellVariant;
})();
