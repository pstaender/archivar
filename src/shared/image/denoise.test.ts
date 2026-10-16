import { describe, expect, test } from "bun:test";
import { removeSpecks, smoothNoise } from "./denoise";
import type { RawImage } from "./raw";

function blank(width: number, height: number, value = 255): RawImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(value);
  return { width, height, data };
}

function paint(image: RawImage, x: number, y: number, w: number, h: number, value = 0) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * image.width + xx) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    }
  }
}

const pixel = (image: RawImage, x: number, y: number) => image.data[(y * image.width + x) * 4];

describe("smoothNoise", () => {
  test("flattens grain on paper but keeps strong edges", () => {
    const image = blank(2000, 40, 200);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = 200 + ((i / 4) % 2 === 0 ? 12 : -12);
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    }
    paint(image, 0, 0, 1000, 40, 20);
    const out = smoothNoise(image, 2);
    expect(Math.abs(pixel(out, 1500, 20)! - 200)).toBeLessThan(6);
    expect(pixel(out, 990, 20)!).toBeLessThan(40);
    expect(pixel(out, 1010, 20)!).toBeGreaterThan(180);
    expect(out.data[3]).toBe(255);
  });
});

describe("removeSpecks", () => {
  test("removes isolated dots but keeps text and dots next to it", () => {
    const image = blank(2000, 300);
    paint(image, 40, 60, 60, 30);
    paint(image, 104, 85, 3, 3);
    paint(image, 600, 150, 3, 3);
    paint(image, 1200, 40, 3, 30);
    removeSpecks(image, 2);
    expect(pixel(image, 50, 70)).toBe(0);
    expect(pixel(image, 105, 86)).toBe(0);
    expect(pixel(image, 601, 151)).toBe(255);
    expect(pixel(image, 1201, 50)).toBe(0);
  });

  test("leaves clean pages unchanged", () => {
    const image = blank(2000, 50);
    removeSpecks(image, 3);
    expect(image.data.every((v) => v === 255)).toBe(true);
  });
});
