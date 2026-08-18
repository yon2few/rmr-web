# rmr web — Agent Refresher

Local folder: `rmr web`. Created 2026-08-18 as the public web port of
`RMR Extension (scratch)`. Folder name is local only.

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

## Engine copy

`engine/` is a verbatim copy. Refresh with `./refresh-engine-copy.sh`.
Do not edit the copy. Host glue is `host-returns.js` + `host-cloudrun.js`.

## Reddit JSON

Browsers cannot call reddit.com from `artreader.art` (CORS). The page
fetches `api/thread?url=&sort=`. Production maps `/rmr/api/thread` to
the Netlify function. Local: `python3 dev-server.py`.

App Share → Copy link is `/r/{sub}/s/{token}`, not a post id. Resolve
it with authenticated Reddit OAuth on Cloud Run `rmr-share-expand`
(`POST /api/v1/access_token` then `GET oauth.reddit.com` with
`redirect: manual`). Unauthenticated fetches from Netlify / Cloud Run /
Microlink / Jina get 403 with no `Location`. Do not send an unresolved
`/s/` URL into Arctic/Pullpush. Create the Reddit script app at
`https://www.reddit.com/prefs/apps`. First expander deploy:
`REDDIT_CLIENT_ID=… REDDIT_CLIENT_SECRET=… ./deploy-rmr-share-expand-cloudrun.sh`.

## Local harness

```bash
cd "/Users/yonyonson/Developer/ArT Reader/rmr web"
python3 dev-server.py
# http://127.0.0.1:8777/?redditUrl=<url-encoded Reddit thread>
```
