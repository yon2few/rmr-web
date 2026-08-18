# engine/overlay/

The portable returns overlay. This is the `#builtin-overlay` frame playback already talks to — not a second shell.

A host loads these files, mounts the overlay, and drives FullChunk ↔ Page View with `ArtReaderShellRuntime`. Do not load `engine/index.js`. Do not invent another overlay.

## Files

| File | What it is |
|---|---|
| `styles-overlay.css` | Overlay layout, `data-active-view`, `data-pageview-playing` |
| `styles-overlay-actions.css` | Hero button, secondary row, pill chrome |
| `markup.js` | `ArtReaderReturnsOverlay.mount()` — the real overlay DOM |
| `shell-runtime.js` | Writes `data-active-view`, `data-pageview-playing`, hero label |
| `returns-actions.js` | Returns-mode hero + prev/next visibility |

Page View / FullChunk **text** CSS stays in `../styles/`. Highlighting stays in `../playback-module/`.

## Variants

Same flags `/reader` already uses. Not a new API.

- Desktop (default): `includesTouchGestures: false` — no `#pageViewGestureLayer`, no `#pageNavDots`
- Mobile / desktop-with-touch: `includesTouchGestures: true`, or set `ArtReaderShellVariant.includesTouchGestures`

A side panel omits touch. A desktop product that needs mobile passes the existing flag (and, for `/reader`-like mobile layout, still loads `host/styles-mobile.css`). The mobile title bar sits **outside** this overlay and stays host.

## Mount

```js
const { overlay, overlayMain } = window.ArtReaderReturnsOverlay.mount(container, {
  includesTouchGestures: false, // or omit; reads ArtReaderShellVariant if present
  activeView: 'loading'         // /reader injects input and uses 'input'
});
```

Then:

```js
window.ArtReaderShellRuntime.create({
  controllerName: 'Host',
  builtinOverlay: overlay,
  viewNodes: { /* loading, fullchunk, pageview; /reader also has input */ },
  actionNodes: { generateBtn, prevPageBtn, nextPageBtn, /* optional save/export/load/reset */ },
  validModes: ['loading', 'fullchunk', 'pageview'], // /reader also includes 'input'
  delegate: { /* see shell-runtime.js */ }
});
```

A host that also has input prepends `#inputView` as the first child of `overlayMain` — that is what `/reader` does. Do not fork the overlay to drop actions; hide them with the runtime delegate.

## Required DOM (already in the mount)

`#builtin-overlay`, `#headerTitleReadout`, `#loadBtn`, `#speedDisplay`, `#resetBtn`, `#progressBar`, `#loadingView`, `#fullChunkView`, `#fullChunkDisplay`, `#pageView`, `#pageViewDisplay`, `#overlayActions`, `#generateBtn`, `#pageviewPlayHitbox`, `#saveBtn`, `#exportBtn`, `#prevPageBtn`, `#nextPageBtn`, `#consoleErrorNotice`.

Touch-only: `#pageViewGestureLayer`, `#pageNavDots`.

Playback also needs `player.setActiveView` and `player.setOverlayActionState` / `syncOverlayActionState`.

## Tokens

Colors: `../../AGENT_brand-spec-for-build.md` (copy-paste `:root` block). Do not invent a palette.

Sizing tokens live in `host/styles-core.css` (`--overlay-width`, `--overlay-shell-height`, hero sizes, viewport gaps). A constrained host sets those. Do not bake a side-panel width into this folder.

`--overlay-background` in `:root` is **not** the glass. The glass is `.builtin-overlay::before`: `rgba(26, 26, 26, 0.92)`.
