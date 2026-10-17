#!/usr/bin/env bash
# Uploads files to archivar via the REST API.
#
#   ARCHIVAR_TOKEN=arch_… scripts/upload.sh scan.jpg brief.pdf
#   ARCHIVAR_URL=http://nas:3000 ARCHIVAR_FOLDER=wichtig/2026 scripts/upload.sh *.jpg
#
# Create the token in archivar under Einstellungen → API. OCR and the import preset follow the user's settings;
# set ARCHIVAR_OCR=true|false to override text recognition.
#
# Each file's creation date becomes its upload date (the earlier of birth and modification time, as copies often get a
# new birth time); set ARCHIVAR_FILE_DATE=false to use the time of the upload instead.
set -euo pipefail

url="${ARCHIVAR_URL:-http://localhost:3000}"
token="${ARCHIVAR_TOKEN:?Set ARCHIVAR_TOKEN to an API token (Einstellungen → API)}"

if [ "$#" -eq 0 ]; then
  echo "Usage: ARCHIVAR_TOKEN=… $0 FILE…" >&2
  exit 64
fi

# Unix seconds of the file's creation; GNU stat prints 0 or "-" for an unknown birth time.
file_date() {
  local birth modified
  if read -r birth modified < <(stat -c '%W %Y' -- "$1" 2>/dev/null); then :
  else read -r birth modified < <(stat -f '%B %m' -- "$1"); fi
  if [[ "$birth" =~ ^[0-9]+$ ]] && [ "$birth" -gt 0 ] && [ "$birth" -lt "$modified" ]; then
    echo "$birth"
  else
    echo "$modified"
  fi
}

for file in "$@"; do
  args=(-F "files=@${file}")
  [ "${ARCHIVAR_FILE_DATE:-true}" != false ] && args+=(-F "createdAt=$(file_date "$file")")
  [ -n "${ARCHIVAR_FOLDER:-}" ] && args+=(-F "folders=${ARCHIVAR_FOLDER}")
  [ -n "${ARCHIVAR_OCR:-}" ] && args+=(-F "ocr=${ARCHIVAR_OCR}")
  echo "Uploading ${file} …" >&2
  curl --fail-with-body --silent --show-error \
    -H "Authorization: Bearer ${token}" \
    "${args[@]}" \
    "${url}/api/documents"
  echo
done
