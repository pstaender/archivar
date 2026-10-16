import { expect, test } from "bun:test";
import { identityGrid } from "../../../test/server";
import type { DewarpGrid } from "../types";
import { unwarpWithGrid } from "./unwarp";

function gradient(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set([x * 10, y * 10, 100, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

const grid = (points: Float32Array | number[]): DewarpGrid => ({ rotation: 0, columns: 31, rows: 45, points: Array.from(points) });

test("an identity grid reproduces the image", () => {
  const src = gradient(20, 12);
  const out = unwarpWithGrid(src, grid(identityGrid()));
  for (let i = 0; i < src.data.length; i++) expect(Math.abs(out.data[i]! - src.data[i]!)).toBeLessThanOrEqual(1);
});

test("a mirrored grid flips the image horizontally", () => {
  const points = identityGrid();
  for (let i = 0; i < 31 * 45; i++) points[i] = -points[i]!;
  const src = gradient(20, 12);
  const out = unwarpWithGrid(src, grid(points));
  expect(out.data[0]).toBe(src.data[19 * 4]!);
});

test("samples outside the image are black and opaque", () => {
  const points = new Array(2 * 31 * 45).fill(5);
  const out = unwarpWithGrid(gradient(4, 4), grid(points), 2, 2);
  expect([...out.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
});

test("supports a different output size", () => {
  const out = unwarpWithGrid(gradient(20, 12), grid(identityGrid()), 10, 6);
  expect(out.width).toBe(10);
  expect(out.height).toBe(6);
  expect(out.data[(5 * 10 + 9) * 4]).toBe(190);
});
