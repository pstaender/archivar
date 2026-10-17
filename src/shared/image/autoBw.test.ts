import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "../editSettings";
import type { EditSettings, Quad } from "../types";
import {
  autoBwVariants,
  distinctThresholds,
  otsuThreshold,
  percentile,
  stretchTone,
  type Histogram,
} from "./autoBw";
import { createImage } from "./jimp";
import { applyEdits } from "./pipeline";

function bimodal(dark: number, light: number, darkCount: number, lightCount: number): Histogram {
  const hist = new Array<number>(256).fill(0);
  for (let d = -6; d <= 6; d++) {
    hist[dark + d] = darkCount / 13;
    hist[light + d] = lightCount / 13;
  }
  return hist;
}

function scannedPage(width = 200, height = 260) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 24;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ink = y % 20 < 4 && x > 20 && x < width - 20 && x % 12 < 8;
      const v = (ink ? 80 : 175) + noise();
      data.set([v, v, v * 0.95, 255], (y * width + x) * 4);
    }
  }
  return { image: createImage(width, height, data), isInk: (x: number, y: number) => y % 20 < 4 && x > 20 && x < width - 20 && x % 12 < 8 };
}

describe("thresholds", () => {
  test("otsu splits two peaks in the middle", () => {
    const t = otsuThreshold(bimodal(60, 200, 1000, 1000));
    expect(t).toBeGreaterThan(66);
    expect(t).toBeLessThanOrEqual(194);
  });

  test("percentile", () => {
    const hist = new Array<number>(256).fill(0);
    hist[10] = 50;
    hist[200] = 50;
    expect(percentile(hist, 0.01)).toBe(10);
    expect(percentile(hist, 0.99)).toBe(200);
  });

  test("distinct thresholds drop near duplicates and keep order", () => {
    expect(distinctThresholds([120, 125, 150, 90, 0])).toEqual([120, 150, 90, 1]);
  });
});

describe("stretchTone", () => {
  test("maps low to black and high to white", () => {
    const { brightness, contrast } = stretchTone(40, 220);
    const factor = (contrast + 1) / (1 - contrast);
    const map = (v: number) => factor * (v * (1 + brightness) - 127) + 127;
    expect(map(40)).toBeCloseTo(0, -1);
    expect(map(220)).toBeCloseTo(255, -1);
  });

  test("leaves flat images alone", () => {
    expect(stretchTone(120, 125)).toEqual({ brightness: 0, contrast: 0 });
  });
});

describe("autoBwVariants", () => {
  const wrongPixels = (settings: EditSettings) => {
    const { image, isInk } = scannedPage();
    const variants = autoBwVariants(image, settings);
    expect(variants.length).toBeGreaterThanOrEqual(2);
    const out = applyEdits(image, { ...settings, ...variants[0]!, colorMode: "bw" });
    let wrong = 0;
    for (let y = 0; y < image.bitmap.height; y++) {
      for (let x = 0; x < image.bitmap.width; x++) {
        const black = out.bitmap.data[(y * image.bitmap.width + x) * 4] === 0;
        if (black !== isInk(x, y)) wrong++;
      }
    }
    return wrong / (image.bitmap.width * image.bitmap.height);
  };

  test("first variant separates ink from paper", () => {
    expect(wrongPixels(DEFAULT_EDIT_SETTINGS)).toBeLessThan(0.01);
  });

  test("works out the tone after auto levels, which the pipeline applies first", () => {
    const leveled = { ...DEFAULT_EDIT_SETTINGS, autoLevels: true };
    expect(wrongPixels(leveled)).toBeLessThan(0.01);
    const [plain] = autoBwVariants(scannedPage().image, DEFAULT_EDIT_SETTINGS);
    const [afterLevels] = autoBwVariants(scannedPage().image, leveled);
    expect(afterLevels!.contrast).toBeLessThan(plain!.contrast);
  });

  test("variants share the tone; the second is darker, the third lighter", () => {
    const variants = autoBwVariants(scannedPage().image, DEFAULT_EDIT_SETTINGS);
    expect(variants).toHaveLength(3);
    expect(new Set(variants.map((v) => `${v.brightness}/${v.contrast}`)).size).toBe(1);
    const [best, darker, lighter] = variants.map((v) => v.bwThreshold);
    expect(darker!).toBeGreaterThan(best!);
    expect(lighter!).toBeLessThan(best!);
  });

  test("keeps a blank region white instead of amplifying paper noise", () => {
    const { image } = scannedPage();
    const settings = { ...DEFAULT_EDIT_SETTINGS, corners: [{ x: 0, y: 0 }, { x: 0.05, y: 0 }, { x: 0.05, y: 1 }, { x: 0, y: 1 }] satisfies Quad };
    const variants = autoBwVariants(image, settings);
    expect(variants[0]!.contrast).toBe(0);
    const out = applyEdits(image, { ...settings, ...variants[0]!, colorMode: "bw" });
    let black = 0;
    for (let i = 0; i < out.bitmap.data.length; i += 4) if (out.bitmap.data[i] === 0) black++;
    expect(black / (out.bitmap.width * out.bitmap.height)).toBeLessThan(0.02);
  });
});
