import { areaPixels } from "../areas";
import type { VectorArea } from "../types";

interface Bitmap {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

/** Replaces the pixels of each vectorized area with its graphic, rendered at the area's size in the bitmap. */
export async function paintVectorAreas(bitmap: Bitmap, areas: VectorArea[]): Promise<void> {
  const { createCanvas, Path2D } = await import("@napi-rs/canvas");
  for (const area of areas) {
    const { graphic } = area;
    if (!graphic) continue;
    const rect = areaPixels(area, bitmap.width, bitmap.height);
    if (rect.width === 0 || rect.height === 0) continue;
    const canvas = createCanvas(rect.width, rect.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = graphic.background;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.scale(rect.width / graphic.width, rect.height / graphic.height);
    for (const path of graphic.paths) {
      ctx.fillStyle = path.fill;
      ctx.fill(new Path2D(path.d));
    }
    const pixels = ctx.getImageData(0, 0, rect.width, rect.height).data;
    for (let y = 0; y < rect.height; y++) {
      const target = ((rect.top + y) * bitmap.width + rect.left) * 4;
      bitmap.data.set(pixels.subarray(y * rect.width * 4, (y + 1) * rect.width * 4), target);
    }
  }
}
