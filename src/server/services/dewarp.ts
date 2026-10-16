import { existsSync } from "node:fs";
import { DEWARP_GRID_COLUMNS, DEWARP_GRID_ROWS } from "../../shared/editSettings";
import { createImage } from "../../shared/image/jimp";
import type { RawImage } from "../../shared/image/raw";
import type { DewarpGrid, Rotation } from "../../shared/types";

export const UVDOC_INPUT_WIDTH = 488;
export const UVDOC_INPUT_HEIGHT = 712;

export interface DewarpEngine {
  available(): boolean;
  predict(image: RawImage): Promise<Float32Array>;
}

type OrtModule = typeof import("onnxruntime-node");
type Session = Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>;

export function toModelInput(image: RawImage): Float32Array {
  const resized = createImage(image.width, image.height, image.data).resize({ w: UVDOC_INPUT_WIDTH, h: UVDOC_INPUT_HEIGHT });
  const { data } = resized.bitmap;
  const pixels = UVDOC_INPUT_WIDTH * UVDOC_INPUT_HEIGHT;
  const input = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    input[i] = data[i * 4]! / 255;
    input[pixels + i] = data[i * 4 + 1]! / 255;
    input[2 * pixels + i] = data[i * 4 + 2]! / 255;
  }
  return input;
}

export class UvdocEngine implements DewarpEngine {
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

  async predict(image: RawImage): Promise<Float32Array> {
    const { ort, session } = await this.load();
    const tensor = new ort.Tensor("float32", toModelInput(image), [1, 3, UVDOC_INPUT_HEIGHT, UVDOC_INPUT_WIDTH]);
    const result = await session.run({ image: tensor });
    return result.grid!.data as Float32Array;
  }
}

export function toDewarpGrid(points: Float32Array, rotation: Rotation): DewarpGrid {
  return {
    rotation,
    columns: DEWARP_GRID_COLUMNS,
    rows: DEWARP_GRID_ROWS,
    points: Array.from(points, (p) => Math.round(p * 1e5) / 1e5),
  };
}
