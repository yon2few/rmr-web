# Playback Module — Highlighting Engine

The karaoke-style word highlighting shown in **Page View** during audio playback:
the spoken word scales up and lights up, the words just before/after it are
dimmed-but-readable, and everything else is faded. `playback-module/highlighting/`
is the single home for that feature.

This is plain browser JavaScript and CSS, authored as native ES modules
(`import`/`export`, loaded via `<script type="module">`) — no bundler or build
step. A prior packaging script (`scripts/package-artreader-module.mjs`, plain
Node `fs`/`child_process`, removed 2026-06-19 in commit `fba3a60`) concatenated
and zipped an earlier, broader "results module" (`artreader-module/`) for an
unfinished Reddit-extension adapter; that specific script and its target folder
are gone. The underlying goal — a genuinely importable module usable outside
the live reader — is being deliberately picked back up here, scoped to the playback engine
rather than the full results UI.

Each `highlighting/*.js` file both `export`s and assigns to `window`, so the host's
remaining classic-script files (`audio-system.js`, `audio-input-display.js`,
etc.) can keep referencing `CaptionOriginal`/`ClickToSeekManager`/
`PageLineBalancer` as bare globals without becoming modules themselves.
**Important glue this depends on:** `<script type="module">` is always
deferred, so every classic `<script>` tag that comes after playback-module's
tags in each HTML entry point (`audio-controls.js` through `audio-system.js`)
now carries an explicit `defer` attribute too — without it, those classic
scripts would execute *before* the deferred module scripts, and
`new CaptionOriginal(this)` in `audio-system.js` would fail because
`CaptionOriginal` wouldn't exist on `window` yet. Converting the rest of the
app's ~30 scripts to real ES modules (removing the need for this `defer` glue
entirely) is a legitimate but separate, much larger future initiative — not
part of this module's scope.

The only runtime entry point other code touches is `audioSystem.captioning`, which
is a `CaptionOriginal` instance.

---

## Files

| File | Global it defines | Role |
|---|---|---|
| `highlighting/config.js` | `window.ArtReaderHighlightingConfig`, `window.applyHighlightingConfigToCss` | The single source of truth for tunable values. Self-applies its CSS variables at load. |
| `highlighting/color-cycler.js` | `window.ArtReaderColorCycler` | Rotates the active-word color once per speaker-part and advances the slideshow. |
| `highlighting/engine.js` | `class CaptionOriginal` | The engine **and** the public surface (`audioSystem.captioning`). Owns the rAF loop, per-word state, the page-transition gate, and `PauseStateHandler`. |
| `highlighting/pause-state.js` | `class PauseStateHandler` | Renders the paused-word styling when playback stops. Reaches the engine only through `captionSystem.getAudioElement()`/`getContainer()`/`getCurrentPageWords()`/`getCurrentDomWords()` — no more `captionSystem.audioSystem.*` two-level indirection. |
| `highlighting/page-line-balancer.js` | `class PageLineBalancer` | Canvas-measures words and packs them into balanced `.text-line` rows. Still used by the font-fit measurement path (`measurePageViewHeightForFontSize` in `audio-input-display.js`); the main page-render pipeline's line balancing goes through `WordDomRenderer` instead — see below. |
| `highlighting/click-to-seek-manager.js` | `class ClickToSeekManager` | No longer handles clicking (see "Pause and click-to-seek" below) — just `createWordSpans`/`processWords`, still used by the font-fit measurement path. The main page-render pipeline's word-span creation goes through `WordDomRenderer` instead. |
| `highlighting/word-dom-renderer.js` | `class WordDomRenderer` | Owns word-span creation, line balancing, and word-element caching/resolution for the main PageView render path — the engine's own instance (`captioning.wordDomRenderer`). This is what fixed the old `getCurrentDomWords()` dependency on `audioSystem.input.dataDisplay.resolveCurrentWordElements()`: the engine now resolves its own DOM word elements. |
| `highlighting/highlighting.css` | — | Every word-state rule, plus the responsive opacity tokens. |

---

## Load order (load-bearing)

These files are real ES modules now — `engine.js`, `page-line-balancer.js`, and
`word-dom-renderer.js` `import` the config directly, and `engine.js` also imports
`color-cycler.js` and `pause-state.js` — so the browser's module graph resolves
*internal* load order automatically. What
still matters, and is still load-bearing, is the `<script>` tag order and
`type`/`defer` attributes relative to the rest of the app. In both live entry
points (`index.html`, `embed.html`) — plus the parked `shared-desktop.html`/
`shared-mobile.html` in `archive/shared-shell/`, if you're keeping those in
sync — the block appears **before `audio-system.js`** in exactly this order:

```html
<link rel="stylesheet" href="./playback-module/highlighting/highlighting.css">
...
<script type="module" src="./playback-module/highlighting/config.js"></script>
<script type="module" src="./playback-module/highlighting/color-cycler.js"></script>
<script type="module" src="./playback-module/highlighting/click-to-seek-manager.js"></script>
<script type="module" src="./playback-module/highlighting/page-line-balancer.js"></script>
<script type="module" src="./playback-module/highlighting/pause-state.js"></script>
<script type="module" src="./playback-module/highlighting/word-dom-renderer.js"></script>
<script type="module" src="./playback-module/highlighting/engine.js"></script>
<script defer src="./audio-controls.js"></script>
... (every classic script through audio-system.js also carries `defer`)
<script defer src="./audio-system.js"></script>
```

Why the `defer` matters: `type="module"` scripts are always deferred (they run
after the document is parsed), but the ~30 scripts after this block —
`audio-controls.js` through `audio-system.js` — are still classic scripts.
Without `defer` on those too, they'd run *before* the deferred module scripts
finish, and `audio-system.js`'s `this.captioning = new CaptionOriginal(this)`
would fail because `CaptionOriginal` wouldn't be on `window` yet.

The build (`build_artreader_common.sh`, `build_reader_variant` file list) copies
these files; renaming or reordering means editing the HTML (`type="module"` vs
`defer` placement), the build list, and possibly the `import`/`export` paths.

---

## Configuration — what's owned where

`ArtReaderHighlightingConfig` is a frozen object. Read its values directly from
JS; the two that CSS also needs are pushed into CSS custom properties by
`applyHighlightingConfigToCss()`, which runs once at the bottom of the config file.

```js
window.ArtReaderHighlightingConfig = Object.freeze({
  activeScale: 1.13,                                   // active-word grow factor
  palette: ['#FBBF24', '#FD5A1E', '#1E90FF', '#FFFFFF'],
  timings: { pauseDelayMs: 150 },                      // delay before showing pause state
  buffers: { short2: 0.2, short3: 0.15 },             // getLengthAwareBuffer thresholds
  context: { lookaheadCount: 1, lookbackCount: 1 },   // words highlighted around the active one
});
```

### CSS custom properties

| Variable | Set by | Read by | Notes |
|---|---|---|---|
| `--active-word-scale` | config JS (`applyHighlightingConfigToCss`) | `.active` transform in CSS | Mirrors `cfg.activeScale`. **Must equal** the value `PageLineBalancer` measures with (`cfg.activeScale`), or line wrapping and highlight geometry disagree. |
| `--active-word-color` | config sets `palette[0]` initially; `ArtReaderColorCycler` updates it per speaker-part | `.active` color | The one variable that genuinely changes at runtime. |
| `--base-text-opacity` | **CSS only** (`highlighting/highlighting.css`) | dimmed word states | Responsive: `0.3` desktop, `0.58` on touch via `@media (pointer: coarse) and (hover: none)`. |
| `--lookahead-offset` | **CSS only** | lookahead/lookback opacity | Responsive: `0.15` desktop, `0.22` on touch. |

> **Never set `--base-text-opacity` or `--lookahead-offset` from JS.**
> `documentElement.style.setProperty(...)` writes an inline root style that beats
> the stylesheet's media query, which would silently pin touch devices to the
> faint desktop value. They are responsive design tokens; their home is the
> stylesheet.

> The transition duration is intentionally **not** a config value — it is the
> literal `transition: all 0.2s ease` on `.word` (see the CSS model below). It was
> variable-ized once and that caused breakage; keep it literal.

A separate, related token `--fullchunk-base-opacity` (0.5 desktop / 0.58 touch)
lives in `styles-returns-interface-fullchunk.css` and is **not** part of this
system — it only looks similar. Don't merge it back into `--base-text-opacity`;
the desktop values differ on purpose.

---

## The engine: `CaptionOriginal`

`audioSystem.captioning` is a `CaptionOriginal`, constructed via
`reader-playback-adapter.js`'s `createReaderPlaybackAdapter(audioSystem)` — the
engine itself is host-agnostic: `new CaptionOriginal(options)` takes
`{getAudioElement, getContainer, getWords, onSeek, onSpeakingPartAdvance, config}`,
none of them `audioSystem`. The engine never touches `this.audioSystem` anywhere
in its own file; every host-specific value comes through one of those five
injected callbacks. `reader-playback-adapter.js` (repo root) is the only file
that knows both "`AudioSystem` internals" and "playback-module public API" — it
builds the options object from real `AudioSystem` state (`getWords` is a
verbatim port of what used to be the engine's own `getCurrentPageWords()` body;
`onSeek` is a verbatim port of `ClickToSeekManager.handleWordClick`'s non-DOM
side effects, now wired to `engine.attachWordClickToSeek()` — see "Pause and
click-to-seek" below) and is constructed once in `audio-system.js`'s
`initializeModules()`:
```js
this.playbackAdapter = window.ArtReaderReaderPlaybackAdapter.createReaderPlaybackAdapter(this);
this.captioning = this.playbackAdapter.engine;
```
`audioSystem.captioning` still points directly at the engine instance, so every
consumer file's existing call sites (`captioning.updateWordHighlighting()`,
`.isPaused`, `.startHighlighting()`, etc.) needed zero changes — only the
engine's internals changed how they reach the host.

The internal word-cursor-invalidation check (used by the binary-search
`findPrimaryIndexAtTime` optimization) used to compare `audioSystem.currentPageIndex`
directly; since the engine no longer knows what a "page" is, it now compares
whether the `words` array reference returned by `getWords()` changed
(`this.cursorWordsRef`) — valid because every host's word-block objects are
distinct array instances per page/chunk, not because the engine tracks page
identity itself.

**Lifecycle**
- `startHighlighting()` — clears pause state and starts the rAF loop.
- `stopHighlighting()` — cancels the loop and, after `timings.pauseDelayMs` (150 ms),
  asks `PauseStateHandler` to render the paused word. The delay lets in-flight
  `timeupdate` events settle so the pause lands on the right word.
- `cleanup()` — stops and resets all state.

**The rAF loop** (`startAnimationLoop` → `updateWordHighlighting`) runs each frame
while audio is playing, finds the active word for `currentTime`, computes the
active range + lookahead/lookback, and only touches the DOM when state actually
changes (`hasHighlightingChanged`). Per-word CSS classes are swapped by
`applyWordState`; the CSS transition animates the rest.

**`updateWordHighlighting()` has (at least) five real call sites** — keep them
working:
1. the rAF loop (steady playback),
2. the `timeupdate` fallback in `audio-playback.js` (`updateHighlighting()`) — load-bearing for buffering/seek,
3. a one-shot after a page rebuild in `audio-input-display.js`,
4. word click-to-seek, `engine.js`'s `_handleWordClick` (page click in FullChunk
   mode doesn't call this — it defers rendering until Play is pressed),
5. a post-page-select render call in `audio-controls.js` (not previously documented here).

**Public surface used by other files**
- `getAudioElement()`, `getContainer()`, `getCurrentPageWords()` — one-line forwards
  to the `options.getAudioElement`/`getContainer`/`getWords` callbacks injected at
  construction; used internally (rAF loop, `getCurrentDomWords`,
  `cacheCurrentWordElements`) and by `PauseStateHandler`.
- `updateWordHighlighting(t)`, `start/stopHighlighting()`, `updateHighlightingStates(...)`,
  `findWordAtTime(t, words)`
- `get isPaused()` — used by `audio-playback.js` to skip page-display updates while paused.
- `isTransitioningPage` / `setTransitioningPage(v)` — the page-transition gate (below).
- `buildWordContainer(words)`, `balanceWordContainer(container, cb)`,
  `cacheCurrentWordElements()`, `applyInitialWordHighlighting()`,
  `takeCachedWordElements()` — word-DOM ownership, called from
  `audio-input-display.js`'s page-render pipeline.
- `advanceColorForSpeakingPart(i)`, `resetColorState()` — speaker-part color
  rotation, called from `audio-system.js`/`audio-input-cloudrun.js`.
- `resetBlockState()` — per-page-turn state reset, called from
  `audio-input-display.js`.
- `attachWordClickToSeek(container)` — word-level click-to-seek, wired onto
  `pageViewDisplay` by `audio-input-display.js`.

`reader-playback-adapter.js` (host seam, not part of `playback-module/`) exposes
`attachPageClickToSeek(container)` (FullChunk page clicks), plus
`resolvePageArrayIndex`, `getSelectedPageSeekTime`, and `setSelectedPage`
directly — `audio-controls.js`'s `resolveFullChunkPlayPageIndex()` and
`audio-input-display.js`'s post-render page-highlight logic both call these
independently of the click handler itself, found when the split landed.

`highlightWordAtTime(t)` and `applyLookaheadFromPrimaryIndex(i)` were dropped
(had zero call sites anywhere in the app, confirmed by grep, when the host-agnostic
contract landed) rather than carried forward as unused public API.

**Word states** → CSS classes: `active` (+ `paused`), `lookahead`, `lookback`,
`inactive-read`, `inactive-future`, plus `paused-word` (pause handler) and
`selected` (click-to-seek).

### The page-transition gate

`isTransitioningPage` lives on `CaptionOriginal`. The rAF loop reads it internally
and bails while the page DOM is being rebuilt (otherwise the first-word highlight
gets "used up" on the old DOM and never reapplied). The page-render pipeline drives
it through the setter:

- `setTransitioningPage(true)` **before** DOM teardown,
- reset all per-word state,
- `setTransitioningPage(false)` **only after** `applyInitialHighlighting()` + state reset.

`audio-input-cloudrun.js` and `audio-input-data-core.js` read
`captioning.isTransitioningPage` to refuse loading while a transition is in flight.

### State that must reset on every page turn

`audio-input-display.js` calls `captioning.resetBlockState()` when it rebuilds a
page, which clears `currentPrimaryWordIndex`, `activeWordIndices`,
`lookaheadIndices`, `lookbackIndices`, `lastRenderPaused`, `wordStateByIndex`,
`wordCursorIndex`, `cursorWordsRef` in one place (previously eight fields poked
directly from outside with no setter). Stale state here causes missed or stuck
highlights.

`chunk-load-coordinator.js`'s `initializeFirstChunk()` separately calls
`captioning.updateHighlightingStates([], [], [], null)` — **this call is
currently a no-op**: `updateHighlightingStates()`'s 6th parameter (`allWords`)
defaults to `[]` when omitted, and the method returns immediately on
`allWords.length === 0`, before ever touching `this.activeWordIndices` etc. It
was left as-is rather than switched to `resetBlockState()`, since doing so would
turn a no-op into a real reset — a behavior change, not a move. Worth a deliberate
look on its own.

---

## The color cycler

```js
ArtReaderColorCycler.next(state, speakingPartIndex, palette)
```

`audio-system.js`'s `updateHighlightColor(speakingPartIndex)` is a one-line
delegation to `captioning.advanceColorForSpeakingPart(speakingPartIndex)`.
`CaptionOriginal` is the state holder (`currentColorIndex` / `lastSpeakingPartIndex`
live on the engine, not on `AudioSystem`) and passes itself as `state` into
`ArtReaderColorCycler.next(state, speakingPartIndex, palette, onAdvance)`. It
no-ops if the speaking part hasn't changed; otherwise it sets
`--active-word-color` to the next palette entry and calls the `onAdvance`
callback if one was given — the engine passes
`() => window.advanceSlideForAudioPart?.()`, a guarded optional call, so a host
without a slideshow just doesn't pass one and nothing breaks.
`captioning.resetColorState()` nulls `lastSpeakingPartIndex` for a fresh
session (was previously two direct `audioSystem.lastSpeakingPartIndex = null`
pokes in `audio-input-cloudrun.js`).

---

## The CSS rendering model (the "grow")

This is the part most likely to regress, so it is spelled out. The shipped,
known-smooth model:

```css
/* base: plain inline text — keeps the line steady as neighbors change weight */
#pageViewDisplay .word, #pageViewDisplay .word-lite {
    display: inline;
    vertical-align: baseline;
    transition: all 0.2s ease;
    opacity: 0.2;
    font-weight: 400;
}

/* active: the ONLY word that becomes a box, so it can carry the scale transform */
#pageViewDisplay .word.active, #pageViewDisplay .word-lite.active {
    display: inline-block;
    vertical-align: middle;
    transform: scale(var(--active-word-scale, 1.13));
    transform-origin: bottom;
    color: var(--active-word-color);
    background: #000000;
    font-weight: 700;
    opacity: 1;
}
```

The host still uses the literal `#pageViewDisplay` id (created by
`reader-shell-markup.js`, outside this module), unchanged, zero risk. The CSS
used to also match a second, portable `.playback-highlighting` class alternative
for a second host (the Read Me Reddit extension's `#karaokeLine`) to opt into
without knowing about `#pageViewDisplay` — that cross-repo integration point
was removed as this host no longer carries external contracts like this.

**Rules, learned the hard way:**
- **Do not** hoist `display: inline-block` onto the base `.word`. If every word is a
  box, each font-weight change (active → 700, lookahead/lookback → 500) reflows the
  line and the highlight visibly jitters as it sweeps. Base words must stay
  `display: inline` (plain text the browser's shaper keeps steady); only the single
  active word is `inline-block`.
- **Do not** replace the literal `transition: all 0.2s ease` with a CSS variable.
  The duration is a fixed design value, not runtime config; the indirection added a
  way for the transition to silently disappear (→ instant snaps).
- `transform-origin: bottom` and the `inline-block`/`transform` pairing on `.active`
  are required for the grow to animate. Removing any of them leaves the word the
  right size but kills the smooth growth.

> The grow's smoothness can only be judged by watching a real, deployed playback
> session — `node --check`, grep, and a passing build tell you nothing about feel.
> A/B any change to this CSS on a live page before trusting it.

---

## Page line balancing

`PageLineBalancer` canvas-measures each word at `fontSize * cfg.activeScale`
(matching the active scale) and packs words into `.text-line` rows that fit the
container, inserting a single ASCII space between words. It rebalances on window
resize (ignoring sub-20px width changes). Because it measures with explicit padding
and an explicit separator, spacing is managed rather than whitespace-dependent.

The scale it measures with and the CSS `--active-word-scale` must stay equal — both
come from `cfg.activeScale`, which is what keeps them in sync.

---

## Pause and click-to-seek

- **Pause** — on stop, after the 150 ms delay, `PauseStateHandler` marks the
  word at the paused time with `paused-word` (white/bold) and the active word with
  `.active.paused` (which scales back to 1).
- **Click-to-seek** — split by scope. Word clicks are engine-owned
  (`CaptionOriginal.attachWordClickToSeek(container)`, wired onto `pageViewDisplay`
  in `audio-input-display.js`): container-level event delegation so it survives
  `WordDomRenderer` re-wrapping the DOM, toggles `.selected`, calls
  `updateWordHighlighting` internally, then the `onSeek` callback for host-specific
  side effects (audio seek, `selectedWordStartTime`, etc.). Page clicks (FullChunk
  mode) are host-only (`reader-playback-adapter.js`'s `attachPageClickToSeek`,
  wired onto `fullChunkDisplay`) — operates on `.page-container` DOM and
  `audioSystem.progress.syncProgressToSelectedPage()`, concepts the engine has no
  reason to know. The `.playing` class on `#pageViewDisplay` gates the
  active-state rules and is load-bearing.

---

## Guardrails (don't break these)

1. `--active-word-scale` (CSS) and `cfg.activeScale` (balancer) must stay equal.
2. `applyInitialHighlighting()` runs before the rAF loop resumes (prevents a dim-text flash).
3. All per-word `CaptionOriginal` state resets on every page turn.
4. `isTransitioningPage` keeps gating the rAF loop, with the timing above.
5. Click handling stays container-level event delegation.
6. The 150 ms pause delay remains.
7. The `.playing` class on `#pageViewDisplay` stays (until the DOM-ownership phase
   of the extraction changes what it's scoped to — see the CSS model note above).
8. The grow box model stays as documented above (base `inline`, only `.active`
   `inline-block`, literal transition).
9. The responsive opacity tokens stay CSS-owned; never set them from JS.
