#!/usr/bin/env bash
# Downloads UVDoc (MIT, https://github.com/tanguymagne/UVDoc) and exports it to models/uvdoc.onnx.
# Python/torch are only needed for this one-time export, not at runtime.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/models/uvdoc.onnx}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! command -v uv >/dev/null; then
  echo "uv is required (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

git clone --quiet --depth 1 https://github.com/tanguymagne/UVDoc.git "$work/UVDoc"
uv venv --quiet --python 3.12 "$work/venv"
VIRTUAL_ENV="$work/venv" uv pip install --quiet torch onnx --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
"$work/venv/bin/python" "$root/scripts/export_uvdoc_onnx.py" "$work/UVDoc" "$output" 2>/dev/null
