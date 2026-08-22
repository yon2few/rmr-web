#!/bin/bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_SOURCE="/Users/yonyonson/Developer/ArT Reader/RMR - Chrome Extension"
readonly SOURCE_BUNDLE_REL="extension_art-reddit-json"

mode="refresh"
source_repo="${DEFAULT_SOURCE}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      mode="check"
      shift
      ;;
    --source)
      if [[ $# -lt 2 ]]; then
        echo "Error: --source requires an absolute repository path." >&2
        exit 1
      fi
      source_repo="$2"
      shift 2
      ;;
    *)
      echo "Error: unsupported argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "${source_repo}" != /* ]]; then
  echo "Error: shared source path must be absolute: ${source_repo}" >&2
  exit 1
fi
if [[ ! -d "${source_repo}/.git" ]]; then
  echo "Error: shared source is not a Git repository: ${source_repo}" >&2
  exit 1
fi
if [[ ! -f "${source_repo}/${SOURCE_BUNDLE_REL}/manifest.json" ]]; then
  echo "Error: shared source does not contain the RMR extension bundle: ${source_repo}" >&2
  exit 1
fi
if [[ -n "$(git -C "${source_repo}" status --porcelain)" ]]; then
  echo "Error: shared source working tree must be clean before synchronization." >&2
  exit 1
fi

readonly shared_commit="$(git -C "${source_repo}" rev-parse HEAD)"
readonly shared_upstream_commit="$(git -C "${source_repo}" rev-parse '@{u}')"
if [[ "${shared_commit}" != "${shared_upstream_commit}" ]]; then
  echo "Error: shared source HEAD must already be pushed to its upstream branch." >&2
  exit 1
fi

readonly source_bundle="${source_repo}/${SOURCE_BUNDLE_REL}"

for required_path in rmr-client/markup.js rmr-client/styles.css rmr-client/client.js icons test-fixtures; do
  if [[ ! -e "${source_bundle}/${required_path}" ]]; then
    echo "Error: shared allowlist source is missing: ${required_path}" >&2
    exit 1
  fi
done

readonly staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/rmr-sync.XXXXXX")"
cleanup() {
  rm -rf "${staging_dir}"
}
trap cleanup EXIT

mkdir -p "${staging_dir}/rmr-client" "${staging_dir}/icons" "${staging_dir}/test-fixtures"
rsync -a --delete "${source_bundle}/rmr-client/" "${staging_dir}/rmr-client/"
rsync -a --delete "${source_bundle}/icons/" "${staging_dir}/icons/"
rsync -a --delete "${source_bundle}/test-fixtures/" "${staging_dir}/test-fixtures/"

cat > "${staging_dir}/RMR_SYNC.md" <<EOF
# RMR Shared Client Sync

This web consumer mirrors RMR input files from
\`yon2few/rmr-extension-engine-shared\`. Do not edit mirrored files here.
Engine playback is refreshed separately from ArT Reader Engine via
\`./refresh-engine-copy.sh\`.

- Shared RMR commit: \`${shared_commit}\`
- Source bundle: \`extension_art-reddit-json/\`

## Copied inventory

- \`rmr-client/**\` → \`rmr-client/**\`
- \`icons/**\` → \`icons/**\`
- \`test-fixtures/**\` → \`test-fixtures/**\`

Consumer-owned files such as \`index.html\`, \`web-host.css\`,
\`platform-adapter.js\`, Netlify functions, the OAuth/share expansion service,
local proxy, and deploy scripts are never copied from the Chrome repository.
Engine host-shell files live in \`host/\` and refresh from ArT Reader Engine
via \`./refresh-engine-copy.sh\`, not this Chrome mirror.

Refresh only from a clean, pushed producer commit:

\`\`\`bash
./refresh-rmr-client-copy.sh
\`\`\`

Validate without writing and fail on any mirrored drift:

\`\`\`bash
./refresh-rmr-client-copy.sh --check
\`\`\`
EOF

check_file() {
  local expected="$1"
  local actual="$2"
  if [[ ! -f "${actual}" ]] || ! cmp -s "${expected}" "${actual}"; then
    echo "Error: mirrored file drift: ${actual}" >&2
    return 1
  fi
}

check_dir() {
  local expected="$1"
  local actual="$2"
  if [[ ! -d "${actual}" ]] || ! diff -qr "${expected}" "${actual}" >/dev/null; then
    echo "Error: mirrored directory drift: ${actual}" >&2
    return 1
  fi
}

if [[ "${mode}" == "check" ]]; then
  check_file "${staging_dir}/RMR_SYNC.md" "${SCRIPT_DIR}/RMR_SYNC.md"
  check_dir "${staging_dir}/rmr-client" "${SCRIPT_DIR}/rmr-client"
  check_dir "${staging_dir}/icons" "${SCRIPT_DIR}/icons"
  check_dir "${staging_dir}/test-fixtures" "${SCRIPT_DIR}/test-fixtures"
  echo "RMR shared-client copy is synchronized at ${shared_commit}."
  exit 0
fi

cp "${staging_dir}/RMR_SYNC.md" "${SCRIPT_DIR}/RMR_SYNC.md"
mkdir -p "${SCRIPT_DIR}/rmr-client" "${SCRIPT_DIR}/icons" "${SCRIPT_DIR}/test-fixtures"
rsync -a --delete "${staging_dir}/rmr-client/" "${SCRIPT_DIR}/rmr-client/"
rsync -a --delete "${staging_dir}/icons/" "${SCRIPT_DIR}/icons/"
rsync -a --delete "${staging_dir}/test-fixtures/" "${SCRIPT_DIR}/test-fixtures/"

echo "Refreshed RMR shared-client copy from ${shared_commit}."
