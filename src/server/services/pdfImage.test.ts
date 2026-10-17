import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { Jimp } from "../../shared/image/jimp";
import { pdfImageProfile, preparePdfImage } from "./pdfImage";

/** White image with a black left half and a little noise, so JPEG qualities differ in size. */
function canvas(width: number, height: number): Canvas {
  const result = createCanvas(width, height);
  const ctx = result.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width / 2, height);
  for (let i = 0; i < 2000; i++) {
    ctx.fillStyle = `rgb(${(i * 37) % 255}, ${(i * 91) % 255}, ${(i * 13) % 255})`;
    ctx.fillRect((i * 97) % width, (i * 61) % height, 3, 3);
  }
  return result;
}

const size = async (data: Uint8Array) => {
  const { width, height } = (await Jimp.read(Buffer.from(data))).bitmap;
  return [width, height];
};

describe("preparePdfImage", () => {
  test("turns black and white images into 1-bit images at 300 DPI on A4", async () => {
    const image = await preparePdfImage(canvas(2400, 4000), "medium", true);
    if (image.kind !== "bilevel") throw new Error("expected a 1-bit image");
    expect([image.width, image.height]).toEqual([2104, 3507]);
    const rowBytes = Math.ceil(image.width / 8);
    const bits = inflateSync(image.data);
    expect(bits.length).toBe(rowBytes * image.height);
    const row = bits.subarray(1000 * rowBytes, 1001 * rowBytes);
    expect(row[10]).toBe(0x00);
    expect(row[rowBytes - 10]).toBe(0xff);
  });

  test("scales other images to the quality's resolution as JPEG", async () => {
    const source = canvas(2400, 4000);
    const low = await preparePdfImage(source, "low", false);
    expect(low.kind).toBe("jpeg");
    expect(await size(low.data)).toEqual([1052, 1754]);
    const high = await preparePdfImage(source, "high", false);
    expect(await size(high.data)).toEqual([2400, 4000]);
  });

  test("embeds the original losslessly in full resolution, also for black and white", async () => {
    const source = canvas(2400, 4000);
    const image = await preparePdfImage(source, "original", false);
    expect(image.kind).toBe("png");
    expect(await size(image.data)).toEqual([2400, 4000]);
    const bw = await preparePdfImage(source, "original", true);
    expect(bw.kind === "bilevel" && [bw.width, bw.height]).toEqual([2400, 4000]);
  });

  test("custom compression goes from 0 (smallest) to 10 (largest)", async () => {
    expect([pdfImageProfile(0), pdfImageProfile(10)]).toEqual([
      { dpi: 300, jpeg: 5 },
      { dpi: 300, jpeg: 100 },
    ]);
    const source = canvas(800, 1000);
    const strong = await preparePdfImage(source, 0, false);
    const weak = await preparePdfImage(source, 10, false);
    expect(strong.data.length).toBeLessThan(weak.data.length / 3);
  });
});
