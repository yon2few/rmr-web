# rmr web — Agent Refresher

Local folder: `rmr web`. Created 2026-08-18 as the public web port of
the RMR extension. Folder name is local only.

**Input is ours.** Paste a Reddit thread URL, filter, estimate, Generate POST.
**Returns are the shared engine** (`ArT Reader - Engine (shared)/engine/`).
Do not load `engine/index.js`. Brand is the slideshow photograph.

## Deploy identity (folder name is local only)

| Identity | Unchanged value |
|----------|-----------------|
| Public path | `https://artreader.art/rmr` |
| Netlify site | `artreader.art` (ID `c7def6d9-065e-4b3d-a658-773c7ac82299`) |
| Transform service | `read-me-reddit-transform-service` |
| Transform URL | `https://read-me-reddit-transform-service-375541022505.us-central1.run.app` |
| GitHub | `yon2few/rmr-web` |
| Script | `deploy-rmr-web.sh` |
| Share expand | `rmr-share-expand` |
| Share expand URL | `https://rmr-share-expand-375541022505.us-central1.run.app` |
| Reddit OAuth secrets | `reddit-client-id`, `reddit-client-secret` |
| Share expand script | `deploy-rmr-share-expand-cloudrun.sh` |

GCP project: **`artreader`**.

`deploy-rmr-web.sh` copies this app into the shared publish dir
`.netlify/artreader-art/rmr/` and the thread proxy into
`.netlify/artreader-art/netlify/functions/rmr-thread-json.js`. It
requires homepage + `/reader` already present so a publish does not
drop sibling routes.

## Shared client copy

`index.html`, `rmr-client/`, `engine/`, and `icons/` are verbatim mirrors from
`RMR Extension Engine (shared)`. Refresh all of them together with
`./refresh-rmr-client-copy.sh`; validate drift with
`./refresh-rmr-client-copy.sh --check`. See `RMR_SYNC.md` for the producer and
upstream engine commits. Never edit mirrored files in this consumer.

`platform-adapter.js` is the web-only composition root. It owns paste,
clipboard, URL history, `/api/thread`, proxy errors, and the web transform
configuration. MP3 export is disabled by contract. The Netlify functions,
OAuth/share expansion service, local proxy, and deploy scripts remain
consumer-owned.

## Reddit JSON

Browsers cannot call reddit.com from `artreader.art` (CORS). The page
fetches `api/thread?url=&sort=`. Production maps `/rmr/api/thread` to
the Netlify function. Local: `python3 dev-server.py`.

App Share → Copy link is `/r/{sub}/s/{token}`, not a post id. Resolve
it with authenticated Reddit OAuth on Cloud Run `rmr-share-expand`
(`POST /api/v1/access_token` then `GET oauth.reddit.com` with
`redirect: manual`). Thread JSON is the same token:
`GET /thread?url=&sort=` → `oauth.reddit.com{comments}.json`.
Unauthenticated fetches from Netlify / Cloud Run / Microlink / Jina get
403 with no `Location`. Do not send an unresolved `/s/` URL into
Arctic/Pullpush. Create the Reddit script app at
`https://www.reddit.com/prefs/apps`. First expander deploy:
`REDDIT_CLIENT_ID=… REDDIT_CLIENT_SECRET=… ./deploy-rmr-share-expand-cloudrun.sh`.

## Local harness

```bash
cd "/Users/yonyonson/Developer/ArT Reader/rmr web"
python3 dev-server.py
# http://127.0.0.1:8777/?redditUrl=<url-encoded Reddit thread>
# Deterministic mirrored fixture:
# http://127.0.0.1:8777/?redditUrl=https%3A%2F%2Fwww.reddit.com%2Fr%2Ftesting%2Fcomments%2Fabc123%2Ffixture&listingUrl=http%3A%2F%2F127.0.0.1%3A8777%2Ftest-fixtures%2Fthread-listing.json
```
