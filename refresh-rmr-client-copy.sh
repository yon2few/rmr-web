#!/bin/bash

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DEFAULT_SOURCE="/Users/yonyonson/Developer/ArT Reader/RMR Extension Engine (shared)"
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
readonly engine_sync="${source_bundle}/engine/SYNC.md"
if [[ ! -f "${engine_sync}" ]]; then
  echo "Error: shared source is missing engine/SYNC.md." >&2
  exit 1
fi
readonly engine_commit="$(sed -n 's/^Commit: \([0-9a-f][0-9a-f]*\)$/\1/p' "${engine_sync}")"
if [[ ! "${engine_commit}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Error: engine/SYNC.md does not contain a valid 40-character upstream commit." >&2
  exit 1
fi

for required_path in sidepanel.html rmr-client engine icons test-fixtures; do
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

mkdir -p "${staging_dir}/rmr-client" "${staging_dir}/engine" "${staging_dir}/icons" "${staging_dir}/test-fixtures"
cp "${source_bundle}/sidepanel.html" "${staging_dir}/index.html"
rsync -a --delete "${source_bundle}/rmr-client/" "${staging_dir}/rmr-client/"
rsync -a --delete "${source_bundle}/engine/" "${staging_dir}/engine/"
rsync -a --delete "${source_bundle}/icons/" "${staging_dir}/icons/"
rsync -a --delete "${source_bundle}/test-fixtures/" "${staging_dir}/test-fixtures/"

cat > "${staging_dir}/RMR_SYNC.md" <<EOF
# RMR Shared Client Sync

This web consumer mirrors a committed allowlist from
\`yon2few/rmr-extension-engine-shared\`. Do not edit mirrored files here.

- Shared RMR commit: \`${shared_commit}\`
- Upstream engine commit: \`${engine_commit}\`
- Source bundle: \`extension_art-reddit-json/\`

## Copied inventory

- \`sidepanel.html\` → \`index.html\`
- \`rmr-client/**\` → \`rmr-client/**\`
- \`engine/**\` → \`engine/**\`
- \`icons/**\` → \`icons/**\`
- \`test-fixtures/**\` → \`test-fixtures/**\`

Consumer-owned files such as \`platform-adapter.js\`, Netlify functions,
the OAuth/share expansion service, local proxy, and deploy scripts are never
copied from the shared repository.

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
  check_file "${staging_dir}/index.html" "${SCRIPT_DIR}/index.html"
  check_file "${staging_dir}/RMR_SYNC.md" "${SCRIPT_DIR}/RMR_SYNC.md"
  check_dir "${staging_dir}/rmr-client" "${SCRIPT_DIR}/rmr-client"
  check_dir "${staging_dir}/engine" "${SCRIPT_DIR}/engine"
  check_dir "${staging_dir}/icons" "${SCRIPT_DIR}/icons"
  check_dir "${staging_dir}/test-fixtures" "${SCRIPT_DIR}/test-fixtures"
  echo "RMR shared-client copy is synchronized at ${shared_commit}."
  exit 0
fi

cp "${staging_dir}/index.html" "${SCRIPT_DIR}/index.html"
cp "${staging_dir}/RMR_SYNC.md" "${SCRIPT_DIR}/RMR_SYNC.md"
mkdir -p "${SCRIPT_DIR}/rmr-client" "${SCRIPT_DIR}/engine" "${SCRIPT_DIR}/icons" "${SCRIPT_DIR}/test-fixtures"
rsync -a --delete "${staging_dir}/rmr-client/" "${SCRIPT_DIR}/rmr-client/"
rsync -a --delete "${staging_dir}/engine/" "${SCRIPT_DIR}/engine/"
rsync -a --delete "${staging_dir}/icons/" "${SCRIPT_DIR}/icons/"
rsync -a --delete "${staging_dir}/test-fixtures/" "${SCRIPT_DIR}/test-fixtures/"

echo "Refreshed RMR shared-client copy from ${shared_commit}."
