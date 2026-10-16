import { expect, test } from "bun:test";
import { medianFilter } from "./denoise";

function gray(width: number, height: number, values: number[]) {
  const data = new Uint8ClampedArray(width * height * 4);
  values.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  return { width, height, data };
}

function brute(values: number[], width: number, height: number, radius: number) {
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const window: number[] = [];
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cx = Math.min(width - 1, Math.max(0, x + dx));
          const cy = Math.min(height - 1, Math.max(0, y + dy));
          window.push(values[cy * width + cx]!);
        }
      }
      window.sort((a, b) => a - b);
      out.push(window[Math.floor(window.length / 2)]!);
    }
  }
  return out;
}

test("removes salt-and-pepper noise", () => {
  const values = new Array(25).fill(100);
  values[12] = 255;
  values[6] = 0;
  const out = medianFilter(gray(5, 5, values), 1);
  for (let i = 0; i < out.data.length; i += 4) expect(out.data[i]).toBe(100);
});

test("matches a brute-force median for random data", () => {
  const width = 13;
  const height = 9;
  const values = Array.from({ length: width * height }, (_, i) => (i * 7919) % 256);
  for (const radius of [1, 2, 3]) {
    const out = medianFilter(gray(width, height, values), radius);
    const expected = brute(values, width, height, radius);
    expected.forEach((v, i) => expect(out.data[i * 4]).toBe(v));
  }
});

test("radius 0 copies the image", () => {
  const img = gray(2, 1, [10, 20]);
  expect([...medianFilter(img, 0).data]).toEqual([...img.data]);
});
