# RMR mobile parking lot

Parked 2026-08-18. Not in progress.

## Official Reddit listing, then Paste + layout

The estimate sliders and sort pills already recompute `estTime` from cached
JSON. Comments moves the number. Replies / replies-to-replies / Best / Top /
Newest / Oldest look dead because the listing is thinner than RMR Desktop
Chrome Extension, not because the timer ignores those controls.

RMR Desktop Chrome Extension loads `{thread}.json?sort=&raw_json=1` from a
logged-in Reddit tab (nested tree, sort applied). RMR mobile `/rmr/api/thread`
still falls through unauthenticated `.json` (403) to Pullpush `size=100` and
Arctic `limit=100` with weak or no sort.

Use the existing Cloud Run Reddit app token for the comments listing:

`GET oauth.reddit.com{comments path}.json?sort={best→confidence|top|new|old}&raw_json=1&limit=100`

Return Reddit’s listing as-is. Do not flatten. Do not walk `more` children
(desktop does not). Pullpush / Arctic last-resort only. Do not send an
unresolved `/s/` URL into archives. Do not put Reddit secrets on Netlify.

Then:

- Empty state: large **Paste** hero (ArT Reader mobile language). Clipboard
  URL → fetch JSON → full RMR interface. Reset returns to Paste.
- Loaded layout: title chrome → sliders (stay with the tree) → visualizer →
  sort + Post Only → timer + Read Me Reddit hero.

Out of scope: RMR Desktop Chrome Extension, engine copy, expanding `more`
objects.
