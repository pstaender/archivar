import { expect, test } from "bun:test";
import { DEFAULT_VECTOR_SETTINGS } from "../settings";
import { paintVectorAreas } from "./paint";

test("replaces the area's pixels with the graphic scaled to its size", async () => {
  const width = 100;
  const height = 50;
  const bitmap = { width, height, data: new Uint8Array(width * height * 4).fill(128) };
  await paintVectorAreas(bitmap, [
    {
      id: "a",
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
      settings: DEFAULT_VECTOR_SETTINGS,
      // The left half black, in a 10 × 10 coordinate system.
      graphic: { width: 10, height: 10, background: "#ffffff", paths: [{ d: "M0 0L5 0L5 10L0 10Z", fill: "#000000" }] },
    },
    { id: "b", x: 0, y: 0, width: 0.5, height: 1, settings: DEFAULT_VECTOR_SETTINGS, graphic: null },
  ]);
  const pixel = (x: number, y: number) => [...bitmap.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  expect(pixel(10, 10)).toEqual([128, 128, 128, 128]);
  expect(pixel(60, 25)).toEqual([0, 0, 0, 255]);
  expect(pixel(90, 25)).toEqual([255, 255, 255, 255]);
});
