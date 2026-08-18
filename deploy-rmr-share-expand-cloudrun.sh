#!/bin/bash
# Folder name is local only. Cloud Run identity stays rmr-share-expand.

set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ID="artreader"
readonly REGION="us-central1"
readonly SERVICE_NAME="rmr-share-expand"
readonly IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"
readonly SOURCE_DIR="${SCRIPT_DIR}/expand-service"

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
  --max-instances 3

gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(status.url)'
