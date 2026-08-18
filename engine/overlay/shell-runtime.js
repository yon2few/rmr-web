(function initializeArtReaderShellRuntime() {
    if (typeof window === 'undefined') {
        throw new Error('[ShellRuntime] window is required.');
    }

    function assertPlainObject(value, message) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error(message);
        }
    }

    function assertBooleanMap(map, messagePrefix) {
        assertPlainObject(map, `${messagePrefix} must be an object.`);
        Object.entries(map).forEach(([key, value]) => {
            if (typeof value !== 'boolean') {
                throw new Error(`${messagePrefix}.${key} must be a boolean.`);
            }
        });
    }

    function normalizeHeroDescriptor(controllerName, descriptor) {
        assertPlainObject(descriptor, `[${controllerName}] Hero descriptor must be an object.`);

        const { action, label, disabled = false, stateClass } = descriptor;
        if (typeof action !== 'string' || action.trim().length === 0) {
            throw new Error(`[${controllerName}] Hero descriptor action must be a non-empty string.`);
        }
        if (typeof label !== 'string' || label.trim().length === 0) {
            throw new Error(`[${controllerName}] Hero descriptor label must be a non-empty string.`);
        }
        if (stateClass !== undefined && stateClass !== null && (typeof stateClass !== 'string' || stateClass.trim().length === 0)) {
            throw new Error(`[${controllerName}] Hero descriptor stateClass must be a non-empty string when provided.`);
        }

        return {
            action: action.trim(),
            label: label.trim(),
            disabled: !!disabled,
            stateClass: typeof stateClass === 'string' ? stateClass.trim() : null
        };
    }

    window.ArtReaderShellRuntime = Object.freeze({
        create(config) {
            assertPlainObject(config, '[ShellRuntime] create() requires a configuration object.');

            const {
                controllerName,
                builtinOverlay,
                viewNodes,
                actionNodes,
                validModes,
                delegate
            } = config;

            if (typeof controllerName !== 'string' || controllerName.trim().length === 0) {
                throw new Error('[ShellRuntime] controllerName must be a non-empty string.');
            }
            if (!builtinOverlay) {
                throw new Error(`[${controllerName}] Missing required #builtin-overlay.`);
            }
            assertPlainObject(viewNodes, `[${controllerName}] viewNodes must be an object.`);
            assertPlainObject(actionNodes, `[${controllerName}] actionNodes must be an object.`);
            if (!Array.isArray(validModes) || validModes.length === 0) {
                throw new Error(`[${controllerName}] validModes must be a non-empty array.`);
            }
            assertPlainObject(delegate, `[${controllerName}] delegate must be an object.`);

            const validModeSet = new Set(validModes);

            [
                'getCurrentMode',
                'setCurrentMode',
                'getIsPlaying',
                'getIsGenerating',
                'getHasAudio',
                'getCanSave',
                'getCanExport',
                'getCanShare',
                'getCanReset',
                'getOverlayActionVisibility',
                'getButtonDisabledState',
                'resolveHeroAction'
            ].forEach((methodName) => {
                if (typeof delegate[methodName] !== 'function') {
                    throw new Error(`[${controllerName}] delegate.${methodName} must be a function.`);
                }
            });

            function setActiveView(mode) {
                if (!validModeSet.has(mode)) {
                    throw new Error(`[${controllerName}] Invalid active view "${mode}" requested.`);
                }

                delegate.setCurrentMode(mode);
                builtinOverlay.dataset.activeView = mode;

                Object.entries(viewNodes).forEach(([viewKey, node]) => {
                    if (!node) {
                        throw new Error(`[${controllerName}] Missing view node for "${viewKey}".`);
                    }
                    const isActive = viewKey === mode;
                    node.hidden = !isActive;
                    node.classList.toggle('is-active', isActive);
                });

                if (typeof delegate.onModeChanged === 'function') {
                    delegate.onModeChanged(mode);
                }
            }

            function createOverlayActionState(overrides = {}) {
                return {
                    mode: delegate.getCurrentMode(),
                    isPlaying: delegate.getIsPlaying(),
                    hasAudio: delegate.getHasAudio(),
                    isGenerating: delegate.getIsGenerating(),
                    canSave: delegate.getCanSave(),
                    canExport: delegate.getCanExport(),
                    canShare: delegate.getCanShare(),
                    canReset: delegate.getCanReset(),
                    ...overrides
                };
            }

            function setOverlayActionVisibility(mode) {
                const visibility = delegate.getOverlayActionVisibility(mode);
                assertBooleanMap(visibility, `[${controllerName}] overlay action visibility`);

                Object.entries(visibility).forEach(([elementKey, isVisible]) => {
                    const element = actionNodes[elementKey];
                    if (!element) {
                        return;
                    }
                    element.hidden = !isVisible;
                });
            }

            function setOverlayActionState(state = {}) {
                assertPlainObject(state, `[${controllerName}] Overlay action state must be an object.`);

                const nextState = createOverlayActionState(state);
                const {
                    mode,
                    isPlaying,
                    hasAudio,
                    isGenerating,
                    canSave,
                    canExport,
                    canShare,
                    canReset
                } = nextState;
                setActiveView(mode);
                builtinOverlay.dataset.pageviewPlaying = (mode === 'pageview' && !!isPlaying) ? 'true' : 'false';
                if (!builtinOverlay._pageviewHitboxWired) {
                    const hitbox = builtinOverlay.querySelector('#pageviewPlayHitbox');
                    const heroBtn = builtinOverlay.querySelector('#generateBtn');
                    if (hitbox && heroBtn) {
                        hitbox.addEventListener('click', () => heroBtn.click());
                        builtinOverlay._pageviewHitboxWired = true;
                    }
                }
                setOverlayActionVisibility(mode);

                const heroButton = actionNodes.generateBtn;
                const heroLabel = heroButton?.querySelector('.btn-label');
                if (heroButton) {
                    const heroDescriptor = normalizeHeroDescriptor(
                        controllerName,
                        delegate.resolveHeroAction({
                            mode,
                            isPlaying: !!isPlaying,
                            hasAudio: !!hasAudio,
                            isGenerating: !!isGenerating
                        })
                    );

                    heroButton.classList.remove('generate-state', 'paste-state', 'play-state', 'pause-state', 'idle-input-state', 'failed');
                    if (heroDescriptor.stateClass) {
                        heroButton.classList.add(heroDescriptor.stateClass);
                    }

                    heroButton.dataset.heroAction = heroDescriptor.action;
                    heroButton.disabled = heroDescriptor.disabled;

                    if (heroLabel) {
                        heroLabel.textContent = heroDescriptor.label;
                    } else {
                        heroButton.textContent = heroDescriptor.label;
                    }
                }

                const buttonDisabledState = delegate.getButtonDisabledState({
                    mode,
                    isPlaying: !!isPlaying,
                    hasAudio: !!hasAudio,
                    isGenerating: !!isGenerating,
                    canSave: !!canSave,
                    canExport: !!canExport,
                    canShare: !!canShare,
                    canReset: !!canReset
                });
                assertBooleanMap(buttonDisabledState, `[${controllerName}] button disabled state`);

                Object.entries(buttonDisabledState).forEach(([elementKey, isDisabled]) => {
                    const element = actionNodes[elementKey];
                    if (!element) {
                        return;
                    }
                    if (typeof isDisabled !== 'boolean') {
                        throw new Error(`[${controllerName}] button disabled state for "${elementKey}" must be a boolean.`);
                    }

                    element.classList.remove('failed');
                    element.disabled = isDisabled;
                });
            }

            function syncOverlayActionState(overrides = {}) {
                setOverlayActionState(createOverlayActionState(overrides));
            }

            return Object.freeze({
                setActiveView,
                createOverlayActionState,
                setOverlayActionVisibility,
                setOverlayActionState,
                syncOverlayActionState
            });
        }
    });
})();
