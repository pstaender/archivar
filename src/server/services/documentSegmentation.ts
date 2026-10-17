import { existsSync } from "node:fs";
import { createImage } from "../../shared/image/jimp";
import type { RawImage } from "../../shared/image/raw";

export const SEGMENTATION_INPUT_SIZE = 384;
const MEAN = [0.4611, 0.4359, 0.3905];
const STD = [0.2193, 0.215, 0.2109];

export interface SegmentationMask {
  width: number;
  height: number;
  /** 255 where the model sees the document, 0 for the background. */
  data: Uint8Array;
}

export interface DocumentSegmenter {
  available(): boolean;
  segment(image: RawImage): Promise<SegmentationMask>;
}

type OrtModule = typeof import("onnxruntime-node");
type Session = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

/** The image squeezed to the model's square input, RGB normalized with the training set's mean and deviation. */
export function toSegmentationInput(image: RawImage): Float32Array {
  const size = SEGMENTATION_INPUT_SIZE;
  const { data } = createImage(image.width, image.height, image.data).resize({ w: size, h: size }).bitmap;
  const pixels = size * size;
  const input = new Float32Array(3 * pixels);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < pixels; i++) input[c * pixels + i] = (data[i * 4 + c]! / 255 - MEAN[c]!) / STD[c]!;
  }
  return input;
}

/** Per pixel argmax of the two classes (background, document). */
export function toMask(logits: Float32Array, size: number): SegmentationMask {
  const pixels = size * size;
  const data = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i++) data[i] = logits[pixels + i]! > logits[i]! ? 255 : 0;
  return { width: size, height: size, data };
}

/** DeepLabV3 with a MobileNetV3-Large backbone trained on documents (LearnOpenCV), see scripts/setup-docseg.sh. */
export class DeeplabSegmenter implements DocumentSegmenter {
  private session: Promise<{ ort: OrtModule; session: Session }> | null = null;

  constructor(private modelPath: string) {}

  available(): boolean {
    return existsSync(this.modelPath);
  }

  private load() {
    this.session ??= import("onnxruntime-node").then(async (ort) => ({
      ort,
      session: await ort.InferenceSession.create(this.modelPath),
    }));
    return this.session;
  }

  async segment(image: RawImage): Promise<SegmentationMask> {
    const { ort, session } = await this.load();
    const size = SEGMENTATION_INPUT_SIZE;
    const tensor = new ort.Tensor("float32", toSegmentationInput(image), [1, 3, size, size]);
    const result = await session.run({ image: tensor });
    return toMask(result.logits!.data as Float32Array, size);
  }
}
