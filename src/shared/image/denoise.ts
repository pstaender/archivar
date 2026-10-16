import type { RawImage } from "./raw";

// Huang's sliding-histogram median filter: O(radius) per pixel instead of sorting each window.
export function medianFilter(src: RawImage, radius: number): RawImage {
  const { width, height, data } = src;
  const out = new Uint8ClampedArray(data.length);
  if (radius < 1) {
    out.set(data);
    return { width, height, data: out };
  }
  const half = Math.floor(((2 * radius + 1) ** 2) / 2);
  const hist = new Int32Array(256);
  const clampX = (x: number) => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y);

  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < height; y++) {
      hist.fill(0);
      for (let dy = -radius; dy <= radius; dy++) {
        const row = clampY(y + dy) * width;
        for (let dx = -radius; dx <= radius; dx++) hist[data[(row + clampX(dx)) * 4 + c]!]!++;
      }
      let median = 0;
      let below = 0;
      while (below + hist[median]! <= half) below += hist[median++]!;
      out[y * width * 4 + c] = median;

      for (let x = 1; x < width; x++) {
        const removeX = clampX(x - radius - 1);
        const addX = clampX(x + radius);
        for (let dy = -radius; dy <= radius; dy++) {
          const row = clampY(y + dy) * width;
          const removed = data[(row + removeX) * 4 + c]!;
          const added = data[(row + addX) * 4 + c]!;
          hist[removed]!--;
          if (removed < median) below--;
          hist[added]!++;
          if (added < median) below++;
        }
        while (below > half) below -= hist[--median]!;
        while (below + hist[median]! <= half) below += hist[median++]!;
        out[(y * width + x) * 4 + c] = median;
      }
    }
  }
  for (let i = 3; i < data.length; i += 4) out[i] = data[i]!;
  return { width, height, data: out };
}
