#!/bin/bash
# Folder name is local only. Publishes static /rmr into the existing
# artreader.art Netlify site (site ID below). Does not rename the site.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROD_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly ARTREADER_SITE_ID="c7def6d9-065e-4b3d-a658-773c7ac82299"
readonly ARTREADER_SITE_URL="https://artreader.art"
readonly BUILD_DIR="${PROD_ROOT}/.netlify/artreader-art"
readonly RMR_BUILD_DIR="${BUILD_DIR}/rmr"
readonly SITE_NETLIFY_TOML="${PROD_ROOT}/netlify.toml"

require_file() {
  local file_path="$1"
  if [[ ! -f "${file_path}" ]]; then
    echo "Error: required deploy artifact is missing: ${file_path}" >&2
    exit 1
  fi
}

command -v netlify >/dev/null 2>&1 || {
  echo "Error: required command is missing: netlify" >&2
  exit 1
}

if [[ ! -f "${SITE_NETLIFY_TOML}" ]]; then
  echo "Error: site netlify.toml is missing: ${SITE_NETLIFY_TOML}" >&2
  exit 1
fi
if [[ ! -f "${BUILD_DIR}/index.html" ]]; then
  echo "Error: shared publish dir is missing homepage. Deploy Site Extras first: ${BUILD_DIR}" >&2
  exit 1
fi
if [[ ! -d "${BUILD_DIR}/reader" ]]; then
  echo "Error: shared publish dir is missing /reader. Deploy Engine first." >&2
  exit 1
fi

rm -rf "${RMR_BUILD_DIR}"
mkdir -p "${RMR_BUILD_DIR}"
rsync -a \
  --exclude '.git' \
  --exclude 'deploy-rmr-web.sh' \
  --exclude 'refresh-rmr-client-copy.sh' \
  --exclude 'RMR_SYNC.md' \
  --exclude 'test-fixtures' \
  --exclude 'dev-server.py' \
  --exclude 'AGENTS.md' \
  --exclude 'netlify' \
  --exclude '.gitignore' \
  "${SCRIPT_DIR}/" "${RMR_BUILD_DIR}/"

mkdir -p "${BUILD_DIR}/netlify/functions"
cp "${SCRIPT_DIR}/netlify/functions/rmr-thread-json.js" \
  "${BUILD_DIR}/netlify/functions/rmr-thread-json.js"

mkdir -p "${PROD_ROOT}/netlify/edge-functions"
cp "${SCRIPT_DIR}/netlify/edge-functions/rmr-expand.js" \
  "${PROD_ROOT}/netlify/edge-functions/rmr-expand.js"

require_file "${RMR_BUILD_DIR}/index.html"
require_file "${RMR_BUILD_DIR}/platform-adapter.js"
require_file "${RMR_BUILD_DIR}/rmr-client/client.js"
require_file "${RMR_BUILD_DIR}/rmr-client/host-returns.js"
require_file "${RMR_BUILD_DIR}/engine/overlay/markup.js"
require_file "${BUILD_DIR}/netlify/functions/rmr-thread-json.js"
cp "${SITE_NETLIFY_TOML}" "${BUILD_DIR}/netlify.toml"

cd "${PROD_ROOT}"

echo "Starting Netlify production deploy for /rmr"

CI=1 netlify deploy \
  --prod \
  --skip-functions-cache \
  --dir "${BUILD_DIR}" \
  --site "${ARTREADER_SITE_ID}" \
  --message "Publish Read Me Reddit web app at /rmr"

echo "Completed rmr web production deploy"
echo "Public URL: ${ARTREADER_SITE_URL}/rmr"
