#!/usr/bin/env bash
# Downloads the document segmentation model of LearnOpenCV's "Document Scanner: Semantic Segmentation using
# PyTorch-DeepLabV3" (https://github.com/spmallick/learnopencv) and exports it to models/docseg.onnx.
# Python/torch are only needed for this one-time export, not at runtime.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
output="${1:-$root/models/docseg.onnx}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if ! command -v uv >/dev/null; then
  echo "uv is required (https://docs.astral.sh/uv/)" >&2
  exit 1
fi

curl -fsSL -o "$work/model.pth" "https://www.dropbox.com/s/4znmfi5ew1u5z9y/model_mbv3_iou_mix_2C049.pth?dl=1"
uv venv --quiet --python 3.12 "$work/venv"
VIRTUAL_ENV="$work/venv" uv pip install --quiet torch torchvision onnx --index-url https://download.pytorch.org/whl/cpu --extra-index-url https://pypi.org/simple
"$work/venv/bin/python" "$root/scripts/export_docseg_onnx.py" "$work/model.pth" "$output" 2>/dev/null
