#!/usr/bin/env bash
# Copy the portable engine extract into this web app. Does not touch host files.
# Source folder name is local only. GitHub stays yon2few/art-reader-engine-frontend-shared.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ENGINE_DIR="${SCRIPT_DIR}/../ArT Reader - Engine (shared)"
readonly ENGINE_SRC="${ENGINE_DIR}/engine"
readonly DEST="${SCRIPT_DIR}/engine"

mode="refresh"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      mode="check"
      shift
      ;;
    *)
      echo "Error: unsupported argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "${ENGINE_SRC}" ]]; then
  echo "Error: Engine extract is missing: ${ENGINE_SRC}" >&2
  exit 1
fi
if [[ ! -d "${ENGINE_DIR}/.git" ]]; then
  echo "Error: Engine folder is not a git repo: ${ENGINE_DIR}" >&2
  exit 1
fi

HASH="$(git -C "${ENGINE_DIR}" rev-parse HEAD)"
if [[ -n "$(git -C "${ENGINE_DIR}" status --porcelain)" ]]; then
  echo "Error: Engine working tree must be clean before refresh: ${ENGINE_DIR}" >&2
  exit 1
fi
readonly engine_upstream="$(git -C "${ENGINE_DIR}" rev-parse '@{u}')"
if [[ "${HASH}" != "${engine_upstream}" ]]; then
  echo "Error: Engine HEAD must already be pushed to its upstream branch." >&2
  exit 1
fi

readonly staging_dir="$(mktemp -d "${TMPDIR:-/tmp}/rmr-engine-sync.XXXXXX")"
cleanup() {
  rm -rf "${staging_dir}"
}
trap cleanup EXIT

mkdir -p "${staging_dir}/loading" "${staging_dir}/overlay" "${staging_dir}/playback" \
  "${staging_dir}/playback-module" "${staging_dir}/styles" "${staging_dir}/transport"
rsync -a --delete "${ENGINE_SRC}/loading/" "${staging_dir}/loading/"
rsync -a --delete "${ENGINE_SRC}/overlay/" "${staging_dir}/overlay/"
rsync -a --delete "${ENGINE_SRC}/playback/" "${staging_dir}/playback/"
rsync -a --delete "${ENGINE_SRC}/playback-module/" "${staging_dir}/playback-module/"
rsync -a --delete "${ENGINE_SRC}/styles/" "${staging_dir}/styles/"
cp "${ENGINE_SRC}/transport/shared-backend-transport.js" "${staging_dir}/transport/shared-backend-transport.js"
cp "${ENGINE_SRC}/AGENTS.md" "${staging_dir}/AGENTS.md"
cp "${ENGINE_SRC}/README.md" "${staging_dir}/README.md"
cp "${ENGINE_SRC}/test-page-turn-timing.mjs" "${staging_dir}/test-page-turn-timing.mjs"

if [[ -e "${staging_dir}/index.js" ]]; then
  echo "Error: refresh copied engine/index.js — that file must not land in the web app." >&2
  exit 1
fi

cat > "${staging_dir}/SYNC.md" <<EOF
Source: ArT Reader - Engine (shared)/engine/
Commit: ${HASH}
Copied: loading/, overlay/, playback/, playback-module/, styles/, transport/shared-backend-transport.js, AGENTS.md, README.md, test-page-turn-timing.mjs
Do not edit these files in place. Refresh is a copy-only commit.
Do not load engine/index.js.
EOF

check_dir() {
  local expected="$1"
  local actual="$2"
  if [[ ! -d "${actual}" ]] || ! diff -qr "${expected}" "${actual}" >/dev/null; then
    echo "Error: mirrored directory drift: ${actual}" >&2
    return 1
  fi
}

check_file() {
  local expected="$1"
  local actual="$2"
  if [[ ! -f "${actual}" ]] || ! cmp -s "${expected}" "${actual}"; then
    echo "Error: mirrored file drift: ${actual}" >&2
    return 1
  fi
}

if [[ "${mode}" == "check" ]]; then
  check_dir "${staging_dir}/loading" "${DEST}/loading"
  check_dir "${staging_dir}/overlay" "${DEST}/overlay"
  check_dir "${staging_dir}/playback" "${DEST}/playback"
  check_dir "${staging_dir}/playback-module" "${DEST}/playback-module"
  check_dir "${staging_dir}/styles" "${DEST}/styles"
  check_file "${staging_dir}/transport/shared-backend-transport.js" "${DEST}/transport/shared-backend-transport.js"
  check_file "${staging_dir}/AGENTS.md" "${DEST}/AGENTS.md"
  check_file "${staging_dir}/README.md" "${DEST}/README.md"
  check_file "${staging_dir}/test-page-turn-timing.mjs" "${DEST}/test-page-turn-timing.mjs"
  check_file "${staging_dir}/SYNC.md" "${DEST}/SYNC.md"
  if [[ -e "${DEST}/index.js" ]]; then
    echo "Error: engine/index.js must not be present in the web app." >&2
    exit 1
  fi
  echo "RMR web engine copy is synchronized at ${HASH}."
  exit 0
fi

mkdir -p "${DEST}/transport"
rsync -a --delete "${staging_dir}/loading/" "${DEST}/loading/"
rsync -a --delete "${staging_dir}/overlay/" "${DEST}/overlay/"
rsync -a --delete "${staging_dir}/playback/" "${DEST}/playback/"
rsync -a --delete "${staging_dir}/playback-module/" "${DEST}/playback-module/"
rsync -a --delete "${staging_dir}/styles/" "${DEST}/styles/"
cp "${staging_dir}/transport/shared-backend-transport.js" "${DEST}/transport/shared-backend-transport.js"
cp "${staging_dir}/AGENTS.md" "${DEST}/AGENTS.md"
cp "${staging_dir}/README.md" "${DEST}/README.md"
cp "${staging_dir}/test-page-turn-timing.mjs" "${DEST}/test-page-turn-timing.mjs"
cp "${staging_dir}/SYNC.md" "${DEST}/SYNC.md"

if [[ -e "${DEST}/index.js" ]]; then
  echo "Error: refresh copied engine/index.js — that file must not land in the web app." >&2
  exit 1
fi

echo "Refreshed engine copy from ${HASH}"
git -C "${SCRIPT_DIR}" status -- "${DEST}"
