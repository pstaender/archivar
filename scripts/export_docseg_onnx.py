"""Export the LearnOpenCV document segmentation model (DeepLabV3, MobileNetV3-Large backbone) to ONNX.

https://learnopencv.com/deep-learning-based-document-segmentation-using-semantic-segmentation-deeplabv3-on-custom-dataset/

Usage:
    python scripts/export_docseg_onnx.py <model_mbv3_iou_mix_2C049.pth> [output.onnx]

Requires: torch, torchvision, onnx (CPU builds are sufficient). Usually run via scripts/setup-docseg.sh.
"""

import sys
from pathlib import Path

import torch
from torchvision.models.segmentation import deeplabv3_mobilenet_v3_large

weights = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2] if len(sys.argv) > 2 else "models/docseg.onnx").resolve()

model = deeplabv3_mobilenet_v3_large(num_classes=2, aux_loss=True, weights=None, weights_backbone=None)
model.load_state_dict(torch.load(weights, map_location="cpu"), strict=False)
model.eval()


class Mask(torch.nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, image):
        return self.net(image)["out"]


dummy = torch.rand(1, 3, 384, 384)
output.parent.mkdir(parents=True, exist_ok=True)
torch.onnx.export(
    Mask(model).eval(),
    (dummy,),
    str(output),
    input_names=["image"],
    output_names=["logits"],
    opset_version=17,
    dynamo=False,
)

with torch.no_grad():
    print("output shape:", tuple(model(dummy)["out"].shape))
print("written:", output)
