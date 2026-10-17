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

  test("grayscale with channels weights each hue", () => {
    const mix = { reds: 100, yellows: 0, greens: 0, cyans: 0, blues: -100, magentas: 0 };
    expect(applyEdits(solid(1, 1, [200, 0, 0, 255]), settings({ colorMode: "grayscale", grayMix: mix })).bitmap.data[0]).toBe(200);
    expect(applyEdits(solid(1, 1, [0, 0, 200, 255]), settings({ colorMode: "grayscale", grayMix: mix })).bitmap.data[0]).toBe(0);
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

  test("denoise smooths single noisy pixels", () => {
    const src = solid(2000, 9, [100, 100, 100, 255]);
    const at = (4 * 2000 + 1000) * 4;
    src.bitmap.data.set([130, 130, 130, 255], at);
    expect(applyEdits(src, settings({ denoise: 2 })).bitmap.data[at]).toBeLessThan(110);
  });

  test("denoise removes specks after black and white", () => {
    const src = solid(2000, 60, [240, 240, 240, 255]);
    const at = (30 * 2000 + 1000) * 4;
    for (const dx of [0, 1]) for (const dy of [0, 1]) src.bitmap.data.set([10, 10, 10, 255], at + (dy * 2000 + dx) * 4);
    const out = applyEdits(src, settings({ colorMode: "bw", bwThreshold: 128, denoise: 1 }));
    expect(out.bitmap.data[at]).toBe(255);
  });
});

test("scaleToFit keeps small images and shrinks large ones", () => {
  expect(scaleToFit(solid(10, 10, [0, 0, 0, 255]), 20).bitmap.width).toBe(10);
  const out = scaleToFit(solid(40, 20, [0, 0, 0, 255]), 20);
  expect(out.bitmap.width).toBe(20);
  expect(out.bitmap.height).toBe(10);
});
