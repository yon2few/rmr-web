# engine/

The portable ArT Reader unit. This is a **file-boundary extract** of the live reader, not a rewrite.

Close enough is a ship-blocker. See `AGENTS.md` in this folder and the repo-root `AGENTS.md`.

| Path | What it is |
|---|---|
| `overlay/` | Mountable `#builtin-overlay` (markup, layout CSS, shell-runtime). See `overlay/README.md`. |
| `playback-module/` | Highlighting + page-turn timing (verbatim) |
| `playback/` | Display, nav, progress, chunk load, controls, save/export, page times, live font resize |
| `transport/` | Backend config, NDJSON, text cleanup |
| `styles/` | PageView, FullChunk, nav, loading CSS |
| `loading/` | Segment-line + first-sentence loading |

Do not invent a second page-turn, highlight, or hydrate. Live `/legacy` is the oracle.
