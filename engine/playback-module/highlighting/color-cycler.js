// Active Word Highlighting - speaker-part color rotation
export const ArtReaderColorCycler = {
    // onAdvance: optional () => void, called after the color actually rotates.
    // Formalizes what was previously an unconditional `window.advanceSlideForAudioPart`
    // global lookup inside this function - callers that have a slideshow pass it in,
    // hosts that don't just omit it.
    next(state, speakingPartIndex, palette, onAdvance) {
        if (!state) {
            throw new Error('[ArtReaderColorCycler] Highlight color state is required.');
        }
        if (!palette || palette.length === 0) {
            throw new Error('[ArtReaderColorCycler] Highlight palette is required.');
        }

        if (speakingPartIndex !== undefined && speakingPartIndex === state.lastSpeakingPartIndex) {
            return;
        }

        state.lastSpeakingPartIndex = speakingPartIndex;
        document.documentElement.style.setProperty('--active-word-color', palette[state.currentColorIndex]);
        state.currentColorIndex = (state.currentColorIndex + 1) % palette.length;

        if (typeof onAdvance === 'function') {
            onAdvance();
        }
    }
};

window.ArtReaderColorCycler = ArtReaderColorCycler;
