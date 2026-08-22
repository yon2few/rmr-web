#!/bin/bash
# Folder name is local only. Cloud Run identity stays rmr-share-expand.
# Resolves Reddit App /s/ share links via authenticated oauth.reddit.com.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ID="artreader"
readonly REGION="us-central1"
readonly SERVICE_NAME="rmr-share-expand"
readonly IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
readonly SOURCE_DIR="${SCRIPT_DIR}/expand-service"
readonly REDDIT_ID_SECRET="reddit-client-id"
readonly REDDIT_SECRET_SECRET="reddit-client-secret"
readonly LOCAL_ENV="/Users/yonyonson/Developer/ArT Reader/Cloud Run - ArT Reader Backend/.env"

project_number="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
if [[ -z "${project_number}" ]]; then
  echo "Error: failed to resolve project number for ${PROJECT_ID}." >&2
  exit 1
fi
runtime_sa="${project_number}-compute@developer.gserviceaccount.com"

load_local_reddit_env() {
  if [[ -n "${REDDIT_CLIENT_ID:-}" && -n "${REDDIT_CLIENT_SECRET:-}" ]]; then
    return
  fi
  if [[ ! -f "${LOCAL_ENV}" ]]; then
    return
  fi
  eval "$(
    python3 - "${LOCAL_ENV}" <<'PY'
from pathlib import Path
import shlex
import sys
wanted = {"REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"}
for line in Path(sys.argv[1]).read_text().splitlines():
    if not line or line.startswith("#") or "=" not in line:
        continue
    name, value = line.split("=", 1)
    if name not in wanted:
        continue
    value = value.strip().strip('"').strip("'")
    print(f"{name}={shlex.quote(value)}")
PY
  )"
}

ensure_secret_from_env() {
  local secret_name="$1"
  local env_name="$2"

  if gcloud secrets describe "${secret_name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Secret ${secret_name} already exists."
    return
  fi

  local value="${!env_name:-}"
  if [[ -z "${value}" ]]; then
    echo "Error: Secret Manager ${secret_name} is missing and ${env_name} is not set." >&2
    exit 1
  fi

  gcloud secrets create "${secret_name}" \
    --project "${PROJECT_ID}" \
    --replication-policy="automatic"
  local tmp
  tmp="$(mktemp)"
  chmod 600 "${tmp}"
  printf '%s' "${value}" > "${tmp}"
  gcloud secrets versions add "${secret_name}" \
    --project "${PROJECT_ID}" \
    --data-file="${tmp}" >/dev/null
  rm -f "${tmp}"
  echo "Created secret ${secret_name}."
}

grant_secret_access() {
  local secret_name="$1"
  gcloud secrets add-iam-policy-binding "${secret_name}" \
    --project "${PROJECT_ID}" \
    --member="serviceAccount:${runtime_sa}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null
}

load_local_reddit_env
ensure_secret_from_env "${REDDIT_ID_SECRET}" "REDDIT_CLIENT_ID"
ensure_secret_from_env "${REDDIT_SECRET_SECRET}" "REDDIT_CLIENT_SECRET"
grant_secret_access "${REDDIT_ID_SECRET}"
grant_secret_access "${REDDIT_SECRET_SECRET}"

gcloud builds submit --tag "${IMAGE}" --project "${PROJECT_ID}" "${SOURCE_DIR}"

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --project "${PROJECT_ID}" \
  --memory 256Mi \
  --cpu 1 \
  --timeout 30 \
  --min-instances 0 \
  --max-instances 3 \
  --set-secrets "REDDIT_CLIENT_ID=${REDDIT_ID_SECRET}:latest,REDDIT_CLIENT_SECRET=${REDDIT_SECRET_SECRET}:latest"

gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.url)'
