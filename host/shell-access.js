(function initializeShellAccess() {
    if (typeof window === 'undefined') {
        throw new Error('[ShellAccess] window is required.');
    }

    function isMobileBrowser() {
        if (window.navigator.userAgentData && typeof window.navigator.userAgentData.mobile === 'boolean') {
            return window.navigator.userAgentData.mobile;
        }

        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator.userAgent);
    }

    window.ArtReaderShellAccess = Object.freeze({
        isMobileBrowser
    });
})();
