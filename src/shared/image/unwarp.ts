import type { DewarpGrid } from "../types";
import type { RawImage } from "./raw";

// Port of UVDoc's bilinear_unwarping: F.interpolate(grid, align_corners=True) followed by
// F.grid_sample(image, grid, align_corners=True, padding_mode="zeros"), fused per pixel.
export function unwarpWithGrid(src: RawImage, grid: DewarpGrid, width = src.width, height = src.height): RawImage {
  const { columns, rows, points } = grid;
  const plane = columns * rows;
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const data = src.data;
  const scaleX = width > 1 ? (columns - 1) / (width - 1) : 0;
  const scaleY = height > 1 ? (rows - 1) / (height - 1) : 0;

  for (let y = 0; y < height; y++) {
    const gy = y * scaleY;
    const r0 = Math.min(rows - 2, Math.floor(gy));
    const ty = gy - r0;
    for (let x = 0; x < width; x++) {
      const gx = x * scaleX;
      const c0 = Math.min(columns - 2, Math.floor(gx));
      const tx = gx - c0;
      const i00 = r0 * columns + c0;
      const i01 = i00 + 1;
      const i10 = i00 + columns;
      const i11 = i10 + 1;
      const w00 = (1 - tx) * (1 - ty);
      const w01 = tx * (1 - ty);
      const w10 = (1 - tx) * ty;
      const w11 = tx * ty;
      const nx = points[i00]! * w00 + points[i01]! * w01 + points[i10]! * w10 + points[i11]! * w11;
      const ny =
        points[plane + i00]! * w00 + points[plane + i01]! * w01 + points[plane + i10]! * w10 + points[plane + i11]! * w11;

      const sx = ((nx + 1) / 2) * (sw - 1);
      const sy = ((ny + 1) / 2) * (sh - 1);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const o = (y * width + x) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        const px = x0 + (k & 1);
        const py = y0 + (k >> 1);
        if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
        const weight = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
        const i = (py * sw + px) * 4;
        r += data[i]! * weight;
        g += data[i + 1]! * weight;
        b += data[i + 2]! * weight;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}
