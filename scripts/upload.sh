#!/usr/bin/env bash
# Uploads files to archivar via the REST API.
#
#   ARCHIVAR_TOKEN=arch_… scripts/upload.sh scan.jpg brief.pdf
#   ARCHIVAR_URL=http://nas:3000 ARCHIVAR_FOLDER=wichtig/2026 scripts/upload.sh *.jpg
#
# Create the token in archivar under Einstellungen → API. OCR and the import preset follow the user's settings;
# set ARCHIVAR_OCR=true|false to override text recognition.
set -euo pipefail

url="${ARCHIVAR_URL:-http://localhost:3000}"
token="${ARCHIVAR_TOKEN:?Set ARCHIVAR_TOKEN to an API token (Einstellungen → API)}"

if [ "$#" -eq 0 ]; then
  echo "Usage: ARCHIVAR_TOKEN=… $0 FILE…" >&2
  exit 64
fi

for file in "$@"; do
  args=(-F "files=@${file}")
  [ -n "${ARCHIVAR_FOLDER:-}" ] && args+=(-F "folders=${ARCHIVAR_FOLDER}")
  [ -n "${ARCHIVAR_OCR:-}" ] && args+=(-F "ocr=${ARCHIVAR_OCR}")
  echo "Uploading ${file} …" >&2
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer ${token}" \
    "${args[@]}" \
    "${url}/api/documents"
  echo
done
