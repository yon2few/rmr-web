# RMR Shared Client Sync

This web consumer mirrors a committed allowlist from
`yon2few/rmr-extension-engine-shared`. Do not edit mirrored files here.

- Shared RMR commit: `5129fc23de3de3f0e0974474a0e17dfe026e2f96`
- Upstream engine commit: `01e82597cdfdfa9a2177d1be8190fd1a31a6d76e`
- Source bundle: `extension_art-reddit-json/`

## Copied inventory

- `sidepanel.html` → `index.html`
- `rmr-client/**` → `rmr-client/**`
- `engine/**` → `engine/**`
- `icons/**` → `icons/**`
- `test-fixtures/**` → `test-fixtures/**`

Consumer-owned files such as `platform-adapter.js`, Netlify functions,
the OAuth/share expansion service, local proxy, and deploy scripts are never
copied from the shared repository.

Refresh only from a clean, pushed producer commit:

```bash
./refresh-rmr-client-copy.sh
```

Validate without writing and fail on any mirrored drift:

```bash
./refresh-rmr-client-copy.sh --check
```
