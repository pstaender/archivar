import { describe, expect, test } from "bun:test";
import { describeGrayMix, GRAY_MIX_PRESETS, grayMixPresetId, LUMA_GRAY_MIX, mixGray, normalizeGrayMix } from "./grayMix";

const BALANCED = GRAY_MIX_PRESETS[0]!.mix;

const mix = { reds: 100, yellows: 50, greens: 0, cyans: 25, blues: -100, magentas: 200 };
const gray = (r: number, g: number, b: number) => {
  const data = new Uint8Array([r, g, b, 255]);
  mixGray(data, mix);
  expect(data[0]).toBe(data[1]!);
  expect(data[1]).toBe(data[2]!);
  expect(data[3]).toBe(255);
  return data[0];
};

describe("grayscale channel mix", () => {
  test("leaves neutral grays unchanged", () => {
    for (const v of [0, 77, 255]) expect(gray(v, v, v)).toBe(v);
  });

  test("weights primary and secondary colours above the darkest channel", () => {
    expect(gray(200, 0, 0)).toBe(200);
    expect(gray(0, 200, 0)).toBe(0);
    expect(gray(200, 200, 0)).toBe(100);
    expect(gray(0, 100, 100)).toBe(25);
    expect(gray(100, 0, 100)).toBe(200);
    expect(gray(50, 50, 250)).toBe(0);
    expect(gray(250, 150, 50)).toBe(50 + 100 * 1 + 100 * 0.5);
  });

  test("matches the plain brightness conversion with the luma weights", () => {
    for (const [r, g, b] of [[250, 150, 50], [10, 200, 90], [30, 60, 240], [255, 0, 255]] as const) {
      const data = new Uint8Array([r, g, b, 255]);
      mixGray(data, LUMA_GRAY_MIX);
      expect(Math.abs(data[0]! - (0.299 * r + 0.587 * g + 0.114 * b))).toBeLessThanOrEqual(1.5);
    }
  });

  test("normalizes stored values and names known mixes", () => {
    expect(normalizeGrayMix({ ...mix, reds: 400.6, blues: -250 })).toEqual({ ...mix, reds: 300, blues: -200 });
    expect(normalizeGrayMix({ reds: 1 })).toBeNull();
    expect(normalizeGrayMix(null)).toBeNull();
    expect(grayMixPresetId(null)).toBe("luma");
    expect(grayMixPresetId(BALANCED)).toBe("balanced");
    expect(grayMixPresetId(mix)).toBeNull();
    expect(grayMixPresetId(LUMA_GRAY_MIX)).toBe("luma");
    expect(describeGrayMix(LUMA_GRAY_MIX)).toBe("Standard");
    expect(describeGrayMix(BALANCED)).toBe("Ausgewogen");
    expect(describeGrayMix(mix)).toBe("Ro 100 Ge 50 Gr 0 Cy 25 Bl -100 Ma 200");
  });
});
