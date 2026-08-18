// Active Word Highlighting - Configuration source of truth
//
// The ONE place that owns the highlighting scale, palette, timing values, the
// length-aware buffer thresholds, and the lookahead/lookback context window.
// JS reads these values from the frozen object directly; the handful that CSS
// also needs are pushed into CSS custom properties by applyHighlightingConfigToCss().
//
// NOTE: the responsive opacity tokens (--base-text-opacity / --lookahead-offset)
// are intentionally NOT owned here. They are responsive design tokens whose source
// of truth is the stylesheet (0.3/0.15 desktop, 0.58/0.22 on touch via media query).
// Setting them from JS would write an inline root style that beats the media query
// and silently pin phones to the faint desktop value.
export const ArtReaderHighlightingConfig = Object.freeze({
    activeScale: 1.13,
    palette: ['#FBBF24', '#FD5A1E', '#1E90FF', '#FFFFFF'],
    timings: {
        pauseDelayMs: 150, // delay before showing the user-pause state
        pageTurnHoldMs: 300, // sit on the last word this long when silence allows
        pageTurnLeadMs: 500, // new page visible this long before the next word is spoken
        pageTurnSwitchBudgetMs: 200 // start the DOM switch this long before land
    },
    buffers: {
        short2: 0.2,
        short3: 0.15
    },
    context: {
        lookaheadCount: 1,
        lookbackCount: 1
    }
});

export function applyHighlightingConfigToCss(cfg) {
    cfg = cfg || ArtReaderHighlightingConfig;
    const root = document.documentElement.style;
    root.setProperty('--active-word-scale', String(cfg.activeScale));
    root.setProperty('--active-word-color', cfg.palette[0]);
}

applyHighlightingConfigToCss(ArtReaderHighlightingConfig);

// Classic-script consumers outside playback-module/ still read this as a
// global (none currently do directly, but kept for continuity/devtools use
// during the transition - see playback-module/AGENTS.md).
window.ArtReaderHighlightingConfig = ArtReaderHighlightingConfig;
window.applyHighlightingConfigToCss = applyHighlightingConfigToCss;
