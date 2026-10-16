import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "../editSettings";
import type { EditSettings } from "../types";
import { createImage } from "./jimp";
import { applyEdits, scaleToFit } from "./pipeline";

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return createImage(width, height, data);
}

function settings(overrides: Partial<EditSettings>): EditSettings {
  return { ...DEFAULT_EDIT_SETTINGS, ...overrides };
}

describe("applyEdits", () => {
  test("does not mutate the source", () => {
    const src = solid(4, 4, [100, 100, 100, 255]);
    applyEdits(src, settings({ brightness: 0.5 }));
    expect(src.bitmap.data[0]).toBe(100);
  });

  test("rotates clockwise", () => {
    const src = createImage(2, 1, new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]));
    const out = applyEdits(src, settings({ rotation: 90 }));
    expect(out.bitmap.width).toBe(1);
    expect(out.bitmap.height).toBe(2);
    expect([...out.bitmap.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  test("crops with an axis-aligned quad", () => {
    const out = applyEdits(
      solid(100, 50, [0, 0, 0, 255]),
      settings({
        corners: [
          { x: 0.1, y: 0.2 },
          { x: 0.6, y: 0.2 },
          { x: 0.6, y: 0.8 },
          { x: 0.1, y: 0.8 },
        ],
      }),
    );
    expect(out.bitmap.width).toBe(50);
    expect(out.bitmap.height).toBe(30);
  });

  test("warps a skewed quad", () => {
    const out = applyEdits(
      solid(100, 100, [0, 0, 0, 255]),
      settings({
        corners: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.2 },
          { x: 0.8, y: 0.9 },
          { x: 0.2, y: 0.8 },
        ],
      }),
    );
    expect(out.bitmap.width).toBeGreaterThan(60);
    expect(out.bitmap.height).toBeGreaterThan(60);
  });

  test("brightness and contrast change pixel values", () => {
    const src = solid(2, 2, [100, 100, 100, 255]);
    expect(applyEdits(src, settings({ brightness: 0.5 })).bitmap.data[0]).toBe(150);
    expect(applyEdits(src, settings({ brightness: -0.5 })).bitmap.data[0]).toBe(50);
    expect(applyEdits(src, settings({ contrast: 0.5 })).bitmap.data[0]!).toBeLessThan(100);
  });

  test("grayscale equalizes channels", () => {
    const out = applyEdits(solid(2, 2, [200, 50, 10, 255]), settings({ colorMode: "grayscale" }));
    const [r, g, b] = out.bitmap.data;
    expect(r).toBe(g!);
    expect(g).toBe(b!);
  });

  test("black and white uses the threshold", () => {
    const src = solid(2, 2, [120, 120, 120, 255]);
    expect(applyEdits(src, settings({ colorMode: "bw", bwThreshold: 100 })).bitmap.data[0]).toBe(255);
    expect(applyEdits(src, settings({ colorMode: "bw", bwThreshold: 200 })).bitmap.data[0]).toBe(0);
  });

  test("hue shifts colors", () => {
    const out = applyEdits(solid(2, 2, [255, 0, 0, 255]), settings({ hue: 120 }));
    const [r, g] = out.bitmap.data;
    expect(g!).toBeGreaterThan(r!);
  });

  test("denoise removes isolated pixels", () => {
    const src = solid(5, 5, [100, 100, 100, 255]);
    src.bitmap.data.set([255, 255, 255, 255], 12 * 4);
    expect(applyEdits(src, settings({ denoise: 1 })).bitmap.data[12 * 4]).toBe(100);
  });
});

test("scaleToFit keeps small images and shrinks large ones", () => {
  expect(scaleToFit(solid(10, 10, [0, 0, 0, 255]), 20).bitmap.width).toBe(10);
  const out = scaleToFit(solid(40, 20, [0, 0, 0, 255]), 20);
  expect(out.bitmap.width).toBe(20);
  expect(out.bitmap.height).toBe(10);
});
