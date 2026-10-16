import { describe, expect, test } from "bun:test";
import type { Quad } from "../types";
import { applyHomography, computeHomography, isAxisAlignedRect, outputSizeForQuad, warpPerspective } from "./perspective";

const unit: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("homography", () => {
  test("maps the four reference points exactly", () => {
    const target: Quad = [
      { x: 10, y: 5 },
      { x: 90, y: 20 },
      { x: 80, y: 70 },
      { x: 5, y: 60 },
    ];
    const h = computeHomography(unit, target);
    unit.forEach((p, i) => {
      const mapped = applyHomography(h, p);
      expect(mapped.x).toBeCloseTo(target[i]!.x, 6);
      expect(mapped.y).toBeCloseTo(target[i]!.y, 6);
    });
  });

  test("throws for degenerate quads", () => {
    const line: Quad = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(() => computeHomography(unit, line)).toThrow();
  });
});

test("outputSizeForQuad uses the longest opposing edges", () => {
  expect(
    outputSizeForQuad([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 120, y: 50 },
      { x: 0, y: 40 },
    ]),
  ).toEqual({ width: 120, height: 54 });
});

test("isAxisAlignedRect", () => {
  expect(isAxisAlignedRect(unit)).toBe(true);
  expect(isAxisAlignedRect([unit[0], unit[1], { x: 0.9, y: 1 }, unit[3]])).toBe(false);
});

test("warpPerspective extracts the selected region", () => {
  const width = 4;
  const height = 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = x >= 2 && y >= 2;
      data[i] = inside ? 255 : 0;
      data[i + 3] = 255;
    }
  }
  const out = warpPerspective({ width, height, data }, [
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 1, y: 1 },
    { x: 0.5, y: 1 },
  ]);
  expect(out.width).toBe(2);
  expect(out.height).toBe(2);
  for (let i = 0; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
});
