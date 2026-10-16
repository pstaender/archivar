"""Export the UVDoc model (https://github.com/tanguymagne/UVDoc, MIT) to ONNX.

Usage:
    python scripts/export_uvdoc_onnx.py <path-to-UVDoc-checkout> [output.onnx]

Requires: torch, onnx (CPU builds are sufficient). Usually run via scripts/setup-uvdoc.sh.
"""

import sys
from pathlib import Path

import torch

uvdoc_dir = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2] if len(sys.argv) > 2 else "models/uvdoc.onnx").resolve()
sys.path.insert(0, str(uvdoc_dir))

from model import UVDocnet  # noqa: E402

model = UVDocnet(num_filter=32, kernel_size=5)
checkpoint = torch.load(uvdoc_dir / "model" / "best_model.pkl", map_location="cpu", weights_only=False)
model.load_state_dict(checkpoint["model_state"])
model.eval()


class Grid2D(torch.nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, image):
        return self.net(image)[0]


dummy = torch.rand(1, 3, 712, 488)
output.parent.mkdir(parents=True, exist_ok=True)
torch.onnx.export(
    Grid2D(model),
    (dummy,),
    str(output),
    input_names=["image"],
    output_names=["grid"],
    opset_version=17,
    dynamo=False,
)

with torch.no_grad():
    print("output shape:", tuple(model(dummy)[0].shape))
print("written:", output)
