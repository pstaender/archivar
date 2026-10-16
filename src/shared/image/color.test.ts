import { describe, expect, test } from "bun:test";
import { adjustColor } from "./color";
import { createImage, type JimpImage } from "./jimp";

function palette(): JimpImage {
  const colors: number[] = [];
  for (let r = 0; r <= 255; r += 15) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 51) colors.push(r, g, b, 255);
    }
  }
  colors.push(255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 254, 1, 127, 255);
  return createImage(colors.length / 4, 1, new Uint8Array(colors));
}

function jimpColor(image: JimpImage, saturation: number, hue: number): JimpImage {
  const actions: Parameters<JimpImage["color"]>[0] = [];
  if (saturation > 0) actions.push({ apply: "saturate", params: [saturation] });
  if (saturation < 0) actions.push({ apply: "desaturate", params: [-saturation] });
  if (hue !== 0) actions.push({ apply: "hue", params: [hue] });
  return image.color(actions) as JimpImage;
}

describe("adjustColor", () => {
  test.each([
    [40, 0],
    [-60, 0],
    [100, 0],
    [-100, 0],
    [0, 90],
    [0, -135],
    [0, 180],
    [25, -40],
    [-30, 170],
  ])("matches Jimp for saturation %d and hue %d", (saturation, hue) => {
    const expected = jimpColor(palette(), saturation, hue).bitmap.data;
    const actual = palette();
    adjustColor(actual.bitmap, saturation, hue);
    let maxDiff = 0;
    for (let i = 0; i < expected.length; i++) maxDiff = Math.max(maxDiff, Math.abs(expected[i]! - actual.bitmap.data[i]!));
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  test("leaves the image untouched without changes", () => {
    const image = palette();
    const before = Uint8Array.from(image.bitmap.data);
    adjustColor(image.bitmap, 0, 0);
    expect(image.bitmap.data).toEqual(Buffer.from(before));
  });
});
