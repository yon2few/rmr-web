# RMR - Web App — Agent Refresher

Local folder: `RMR - Web App` (renamed from `rmr web`). Created 2026-08-18 as
the public web port of the RMR extension. Folder name is local only. GitHub
stays `yon2few/rmr-web`.

**Runtime pipeline, in order:**

1. **Web-only:** paste a Reddit URL; Cloud Run `reddit-url-to-json-service` /
   Netlify `api/thread` returns listing JSON. The Chrome extension does not
   use this path.
2. **RMR Extension input:** once JSON is in hand, mirrored `rmr-client/` owns
   filters, tree, estimate, and the Generate payload.
3. **POST `/run`** to `rmr-backend-cloudrun`.
4. **ArT Reader Engine:** mirrored `engine/` owns loading, Full Chunk, and Page
   View. Do not load `engine/index.js`. Brand is the slideshow photograph.

## Deploy identity (folder name is local only)

| Identity | Unchanged value |
|----------|-----------------|
| Public path | `https://artreader.art/rmr` |
| Netlify site | `artreader.art` (ID `c7def6d9-065e-4b3d-a658-773c7ac82299`) |
| Transform service | `rmr-backend-cloudrun` |
| Transform source | `../Cloud Run - RMR backend` / `yon2few/rmr-backend-cloudrun` |
| Transform URL | `https://rmr-backend-cloudrun-375541022505.us-central1.run.app` |
| GitHub | `yon2few/rmr-web` |
| Script | `deploy-rmr-web.sh` |
| Reddit URL→JSON | `reddit-url-to-json-service` |
| Reddit URL→JSON source | `../Cloud Run - Reddit URL to JSON for Web App` / `yon2few/reddit-url-to-json-service` |
| Reddit URL→JSON URL | `https://reddit-url-to-json-service-375541022505.us-central1.run.app` |
| Reddit OAuth secrets | `reddit-client-id`, `reddit-client-secret` |
| Reddit URL→JSON script | `../Cloud Run - Reddit URL to JSON for Web App/deploy-reddit-url-to-json-service.sh` |

GCP project: **`artreader`**.

`deploy-rmr-web.sh` copies this app into the shared publish dir
`.netlify/artreader-art/rmr/` and the thread proxy into
`.netlify/artreader-art/netlify/functions/rmr-thread-json.js`. It
requires homepage + `/reader` already present so a publish does not
drop sibling routes.

## Dual refresh

`rmr-client/`, `icons/`, and `test-fixtures/` are verbatim mirrors from
`RMR - Chrome Extension`. Refresh with `./refresh-rmr-client-copy.sh`.
`engine/` is a verbatim mirror from `ArT Reader - Engine (shared)`. The
host-shell allowlist (`host/shell-access.js`, `host/shell-router.js`,
`host/shell-variant.js`, `host/styles-mobile.css`) is refreshed from Engine
`host/` by the same `./refresh-engine-copy.sh`. Never edit mirrored files
here. See `RMR_SYNC.md`, `engine/SYNC.md`, and `host/SYNC.md`.

`platform-adapter.js` is the web-only composition root. It owns paste,
clipboard, URL history, `/api/thread`, proxy errors, and the web transform
configuration. After listing JSON returns, shared `rmr-client` takes over.
Production generation streams directly from `rmr-backend-cloudrun`. MP3 export
is disabled by contract. The Netlify functions, local proxy, and deploy
scripts remain consumer-owned. Reddit URL→JSON lives in
`../Cloud Run - Reddit URL to JSON for Web App`.

The `/run` trace is: `rmr-client/domain.js` builds `{ title, subreddit,
flatData }`; `rmr-client/client.js` appends `/run` to the URL returned by
`platform-adapter.js`; `rmr-client/host-returns.js` performs and consumes the
streaming POST. The canonical backend `../Cloud Run - RMR backend`
receives it in `main.py`, delegates transformation and orchestration to
`transform.py`, then streams `artreader-v35/generate-v35-reddit` events back to
this client. The backend README records the exact deployed commit, build,
revision, and image digest.

## Reddit JSON

Browsers cannot call reddit.com from `artreader.art` (CORS). The page
fetches `api/thread?url=&sort=`. Production maps `/rmr/api/thread` to
the Netlify function. `dev-server.py` is retained as consumer-owned legacy
tooling; the workspace-wide deploy-first rule prohibits using it for functional
verification.

App Share → Copy link is `/r/{sub}/s/{token}`, not a post id. Resolve
it with authenticated Reddit OAuth on Cloud Run
`reddit-url-to-json-service` (`POST /api/v1/access_token` then `GET
oauth.reddit.com` with `redirect: manual`). Thread JSON is the same
token: `GET /thread?url=&sort=` → `oauth.reddit.com{comments}.json`.
Unauthenticated fetches from Netlify / Cloud Run / Microlink / Jina get
403 with no `Location`. Do not send an unresolved `/s/` URL into
Arctic/Pullpush. Create the Reddit script app at
`https://www.reddit.com/prefs/apps`. Deploy:
`../Cloud Run - Reddit URL to JSON for Web App/deploy-reddit-url-to-json-service.sh`.

## Validation policy — deploy first

The workspace-wide deploy-first rule in `../AGENTS.md` applies here. Never run
the RMR web app or its browser flows against localhost. After static checks
pass, commit and push the intended source, deploy with `./deploy-rmr-web.sh`,
and test only the deployed `https://artreader.art/rmr` environment. Verify the
homepage and `https://artreader.art/reader` after every RMR deploy so the
shared-site publish cannot silently remove either sibling product.
