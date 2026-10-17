import { describe, expect, test } from "bun:test";
import { SEGMENTATION_INPUT_SIZE, toMask, toSegmentationInput } from "./documentSegmentation";

describe("document segmentation", () => {
  test("squeezes the image to the square input and normalizes each channel", () => {
    const data = new Uint8Array(20 * 10 * 4);
    for (let i = 0; i < 200; i++) data.set([255, 0, 128, 255], i * 4);
    const input = toSegmentationInput({ width: 20, height: 10, data });
    const pixels = SEGMENTATION_INPUT_SIZE ** 2;
    expect(input.length).toBe(3 * pixels);
    expect(input[0]).toBeCloseTo((1 - 0.4611) / 0.2193, 2);
    expect(input[pixels]).toBeCloseTo(-0.4359 / 0.215, 2);
    expect(input[2 * pixels + pixels - 1]).toBeCloseTo((128 / 255 - 0.3905) / 0.2109, 2);
  });

  test("marks pixels where the document class wins", () => {
    const logits = new Float32Array([1, 0, 0.5, 2, 0, 1, 0.4, -1]);
    expect(toMask(logits, 2)).toEqual({ width: 2, height: 2, data: new Uint8Array([0, 255, 0, 0]) });
  });
});
