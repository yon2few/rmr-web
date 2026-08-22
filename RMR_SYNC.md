# RMR Shared Client Sync

This web consumer mirrors RMR input files from
`yon2few/rmr-extension-engine-shared`. Do not edit mirrored files here.
Engine playback is refreshed separately from ArT Reader Engine via
`./refresh-engine-copy.sh`.

- Shared RMR commit: `d257142174a7a0e575fbf2c19554770eac64ea81`
- Source bundle: `extension_art-reddit-json/`

## Copied inventory

- `rmr-client/**` → `rmr-client/**`
- `icons/**` → `icons/**`
- `test-fixtures/**` → `test-fixtures/**`

Consumer-owned files such as `index.html`, `web-host.css`,
`platform-adapter.js`, Netlify functions, the OAuth/share expansion service,
local proxy, and deploy scripts are never copied from the Chrome repository.

Refresh only from a clean, pushed producer commit:

```bash
./refresh-rmr-client-copy.sh
```

Validate without writing and fail on any mirrored drift:

```bash
./refresh-rmr-client-copy.sh --check
```
