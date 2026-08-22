(function bootstrapArtReaderShell() {
    if (typeof window === 'undefined') {
        throw new Error('[ShellRouter] window is required.');
    }
    if (!window.ArtReaderShellAccess) {
        throw new Error('[ShellRouter] window.ArtReaderShellAccess is required.');
    }

    const url = new URL(window.location.href);
    const override = url.searchParams.get('shell');

    function normalizeOverride(value) {
        if (typeof value !== 'string') {
            return null;
        }

        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        if (
            normalized !== 'desktop' &&
            normalized !== 'mobile' &&
            normalized !== 'shared-desktop' &&
            normalized !== 'shared-mobile'
        ) {
            throw new Error(`[ShellRouter] Unsupported shell override "${value}".`);
        }

        return normalized;
    }

    function isMobileBrowser() {
        return window.ArtReaderShellAccess.isMobileBrowser();
    }

    // Shared sessions are parked (see archive/shared-shell/README.md) — a
    // ?share= id or ?shell=shared-* override no longer redirects to a
    // dedicated entry file; it just falls through to the normal reader
    // variant resolution below instead of 404ing.
    const requestedShell = normalizeOverride(override);
    const mobilePreferred = requestedShell === 'mobile' ||
        requestedShell === 'shared-mobile' ||
        (!requestedShell && isMobileBrowser());

    // Reader case: no redirect. The reader lives at this entry point now, so we
    // resolve the device variant in-page and publish it on <html> before the
    // stylesheets paint and before backend-config.js / shell-variant.js read it.
    const variant = requestedShell === 'desktop' || requestedShell === 'mobile'
        ? requestedShell
        : (mobilePreferred ? 'mobile' : 'desktop');
    document.documentElement.dataset.shellVariant = variant;
})();
