# AGENTS.md — playback-module

Scope: this folder, the karaoke-style word highlighting in Page View during
playback (`playback-module/highlighting/`). **Read `README.md` in this folder
before changing anything** — it documents how the system actually works. This file is the
operating manual for making changes safely. The repo-root `AGENTS.md` still
applies on top of this.

## First principles
- Native ES modules, no bundler. Files `import`/`export` each other directly
  (e.g. `engine.js` imports `ArtReaderHighlightingConfig` from `./config.js`
  instead of reading `window.ArtReaderHighlightingConfig`); `<script
  type="module">` in every HTML entry point. Every individual class/const
  also assigns itself to `window`
  (e.g. `window.CaptionOriginal = CaptionOriginal`), so the host's remaining
  classic-script files don't have to become modules themselves. **Load-order
  glue this depends on:** module scripts are always deferred, so every classic
  `<script>` tag after this folder's tags (`audio-controls.js` through
  `audio-system.js`, in every entry point) now has `defer` added too — remove
  that and classic scripts run before the deferred module scripts populate
  `window`, breaking `reader-playback-adapter.js`'s
  `window.ArtReaderReaderPlaybackAdapter.createReaderPlaybackAdapter(this)` call
  in `audio-system.js` (which itself constructs `new CaptionOriginal(options)`).
  A prior
  concatenation-and-zip packaging script (`scripts/package-artreader-module.mjs`,
  removed 2026-06-19, commit `fba3a60`) targeted a different, broader,
  never-finished module (`artreader-module/`) and is not being revived — this is
  a from-scratch, deliberate effort, not a reversal of that removal. There is
  still no `dist/` and no compile step; the module ships as its own readable
  source files, copied as-is by `build_artreader_common.sh`.
- Other code reaches this feature only through runtime symbols —
  `audioSystem.captioning` (a `CaptionOriginal`) and the individual
  `window.*` globals each `highlighting/*.js` file assigns itself to
  — **never by filename**. So renaming a file changes zero runtime behavior, but
  see "Changes that ripple" below for the path-load sites you must update.
- **Throw for missing things the module needs to function at all.** The config
  used to be a `throw`-if-`window.ArtReaderHighlightingConfig`-is-absent check in
  `CaptionOriginal`/`PageLineBalancer`/`WordDomRenderer`'s constructors — now
  that these files `import { ArtReaderHighlightingConfig } from './config.js'`
  directly, the browser's module loader enforces that instead (a missing/broken
  `config.js` fails the whole module graph load, with a clearer error, before any
  of this code runs), so the explicit throw was removed as dead code. **Never
  throw for missing things a specific host happens not to have** — e.g.
  `advanceColorForSpeakingPart()` passes `ArtReaderColorCycler.next()` an
  `onAdvance` callback of `() => window.advanceSlideForAudioPart?.()`, called
  only if that global exists, rather than requiring it.

## The traps (these already bit once — do not repeat)
1. **Do not hoist `display: inline-block` onto the base `.word`.** Base words must
   stay `display: inline`. Making every word a box reflows the line on every
   weight change and the highlight jitters. Only `.active` is `inline-block`.
2. **Keep the literal `transition: all 0.2s ease`** on `.word`. Do not replace it
   with a CSS variable — the duration is a fixed design value, and the indirection
   lets the transition silently vanish (instant snaps = "stiff").
3. **Never set `--base-text-opacity` or `--lookahead-offset` from JS.** They are
   responsive CSS tokens (desktop vs touch via media query). An inline root style
   beats the media query and pins touch devices to the faint desktop value.
4. **Don't variable-ize fixed design constants.** Push a value to a CSS variable
   or the config object only if it's read in two real places (like
   `--active-word-scale`, shared with `PageLineBalancer`) or genuinely varies at
   runtime (like `--active-word-color`). Otherwise leave it literal.
5. **Separate "move it" from "improve it."** A refactor that is supposed to
   preserve behavior must not also reshape rendered behavior for elegance. If you
   want to improve the look/feel, do it as its own deliberate, separately-verified
   change. This applies directly to the ongoing extraction into a portable module:
   each phase is either a structural move or a behavior change, never both at once.

## Changes that ripple beyond this folder
Editing here often requires edits elsewhere — check all of these:
- **Adding/removing/renaming a file:** update the ordered `<script>`/`<link>` block
  in both live entry points (`index.html`, `embed.html`) **keeping load order**
  (the parked `shared-desktop.html`/`shared-mobile.html` in `archive/shared-shell/`
  also load this block — update those too, or accept a catch-up pass when the
  shared shell is un-parked), and update the `build_reader_variant` file list
  in `build_artreader_common.sh`.
- **Load order is load-bearing:** config → color-cycler → click-to-seek →
  page-line-balancer → pause-state → word-dom-renderer → engine →
  `reader-playback-adapter.js` (repo root, outside this folder but part of the
  same `type="module"` block), all before `audio-system.js`. (Details and
  rationale in `README.md`.)
- **Engine surface / gate flag:** the real consumers are `audio-system.js`,
  `audio-playback.js`, `audio-input-display.js`, `audio-navigation.js`,
  `audio-input-cloudrun.js`, `audio-input-data-core.js`, `chunk-load-coordinator.js`,
  and `audio-controls.js` — eight files, not six; the last two were missing from
  this list before and were found by direct code reading. If you touch
  `CaptionOriginal`'s public methods, `isPaused`, or `isTransitioningPage` /
  `setTransitioningPage`, check all eight.
- `--active-word-scale` in CSS must equal `cfg.activeScale` (the balancer measures
  with it). Change one, change both — they both derive from the config.
- PageView page selection/turns resolve via `page-turn-timing.js` (flip at
  `max(prev.end, T − 0.5 − S)`). Sequential playback must not turn during the
  previous last word; seek-from-selection may use the 0.03s undershoot epsilon.
  On the incoming page, word 0 is already active. If you touch page-transition
  timing, see the "PageView playback gotchas" note in the repo-root `AGENTS.md`.

## Verifying changes
- Run `node --check` on any changed `.js`.
- **CSS and animation feel cannot be verified by grep, `node --check`, or a passing
  build.** Any change to the grow, transitions, or word-state CSS needs a real
  **before/after on a deployed, playing session** — including coarse-pointer / touch
  emulation for the opacity tokens.
- **Mind the deploy gap.** Before judging a CSS fix as not working, confirm the live
  asset actually updated:
  ```bash
  curl -fsS "https://artreader.art/v35legacy/playback-module/highlighting/highlighting.css?cb=$RANDOM" | grep -A4 'word-lite {'
  ```
- Re-check the guardrail list in `README.md` ("Guardrails") before finishing.

## Conventions
- No fallback behavior in JS for the module's own required inputs: `getCurrentDomWords()`
  raising a mismatch error if the DOM word count doesn't match expectations is the
  live example today (`word-dom-renderer.js`'s `resolveCurrentWordElements`). This
  is distinct from optional host-specific integrations, which stay guarded
  callbacks — see "First principles" above.
- Keep tunables in `highlighting/config.js`; don't scatter new magic
  numbers across files.
