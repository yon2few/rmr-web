# engine/ AGENTS

Close enough is a ship-blocker.

- Overlay frame lives in `overlay/`. Host brand (palette + slideshow) lives in `../AGENT_brand-spec-for-build.md`. Highlighting speaker palette stays in `playback-module/README.md` — do not merge them.
- Whole files from the extract inventory. Do not subset “the important methods.”
- A commit here is a path/`import` move **or** a behavior change, never both.
- Do not invent `renderPage`, `setInterval` karaoke, fade-to-0 + wipe, or `gapMidpointTime`.
- Keep `page-turn-timing.js` and `test-page-turn-timing.mjs`.
- Playing arrows = speed. Paused Page View arrows = pages. Paused FullChunk arrows = chunks.
- Full generate payload (`chunkSize` 420, `paginationSoftTarget` 60).
