#!/usr/bin/env bash
# Copy the portable engine extract into this web app. Does not touch host files.
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ENGINE_DIR="${SCRIPT_DIR}/../ArT Reader - Engine (shared)"
readonly ENGINE_SRC="${ENGINE_DIR}/engine"
readonly DEST="${SCRIPT_DIR}/engine"

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
  echo "Warning: Engine working tree is dirty. Copying committed HEAD ${HASH} only." >&2
fi

rsync -a --delete "${ENGINE_SRC}/loading/" "${DEST}/loading/"
rsync -a --delete "${ENGINE_SRC}/overlay/" "${DEST}/overlay/"
rsync -a --delete "${ENGINE_SRC}/playback/" "${DEST}/playback/"
rsync -a --delete "${ENGINE_SRC}/playback-module/" "${DEST}/playback-module/"
rsync -a --delete "${ENGINE_SRC}/styles/" "${DEST}/styles/"

mkdir -p "${DEST}/transport"
cp "${ENGINE_SRC}/transport/shared-backend-transport.js" "${DEST}/transport/shared-backend-transport.js"
cp "${ENGINE_SRC}/AGENTS.md" "${DEST}/AGENTS.md"
cp "${ENGINE_SRC}/README.md" "${DEST}/README.md"
cp "${ENGINE_SRC}/test-page-turn-timing.mjs" "${DEST}/test-page-turn-timing.mjs"

if [[ -e "${DEST}/index.js" ]]; then
  echo "Error: refresh copied engine/index.js — that file must not land here." >&2
  exit 1
fi

cat > "${DEST}/SYNC.md" <<EOF
Source: ArT Reader - Engine (shared)/engine/
Commit: ${HASH}
Copied: loading/, overlay/, playback/, playback-module/, styles/, transport/shared-backend-transport.js, AGENTS.md, README.md, test-page-turn-timing.mjs
Do not edit these files in place. Refresh is a copy-only commit.
Do not load engine/index.js.
EOF

echo "Refreshed engine copy from ${HASH}"
git -C "${SCRIPT_DIR}" status -- "${DEST}" || true
