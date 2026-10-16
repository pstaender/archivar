import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { toDewarpGrid, toModelInput, UVDOC_INPUT_HEIGHT, UVDOC_INPUT_WIDTH, UvdocEngine } from "./dewarp";

const MODEL_PATH = resolve("models/uvdoc.onnx");

function solid(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return { width, height, data };
}

test("toModelInput resizes to the model resolution in planar RGB", () => {
  const input = toModelInput(solid(100, 50, [255, 0, 51]));
  const pixels = UVDOC_INPUT_WIDTH * UVDOC_INPUT_HEIGHT;
  expect(input).toHaveLength(3 * pixels);
  expect(input[0]).toBeCloseTo(1);
  expect(input[pixels]).toBeCloseTo(0);
  expect(input[2 * pixels]).toBeCloseTo(0.2);
});

test("toDewarpGrid rounds points and records the rotation", () => {
  const grid = toDewarpGrid(new Float32Array([0.123456789, -0.5]), 180);
  expect(grid).toEqual({ rotation: 180, columns: 31, rows: 45, points: [0.12346, -0.5] });
});

test("reports a missing model", () => {
  expect(new UvdocEngine("/nonexistent/uvdoc.onnx").available()).toBe(false);
});

describe.skipIf(!existsSync(MODEL_PATH))("UVDoc model", () => {
  test("predicts a normalized 2x45x31 grid", async () => {
    const engine = new UvdocEngine(MODEL_PATH);
    const points = await engine.predict(solid(300, 400, [240, 240, 230]));
    expect(points).toHaveLength(2 * 45 * 31);
    expect(points.every((p) => Math.abs(p) <= 1.5)).toBe(true);
  });
});
