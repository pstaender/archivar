import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { createImage, Jimp } from "../../shared/image/jimp";
import { preparePdfImage } from "./pdfImage";

/** White image with a black left half. */
async function jpeg(width: number, height: number): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width / 2; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  return new Uint8Array(await createImage(width, height, data).getBuffer("image/jpeg"));
}

describe("preparePdfImage", () => {
  test("turns black and white images into 1-bit images at 300 DPI on A4", async () => {
    const image = await preparePdfImage(await jpeg(2400, 4000), "300", true);
    if (image.kind !== "bilevel") throw new Error("expected a 1-bit image");
    expect([image.width, image.height]).toEqual([2104, 3507]);
    const rowBytes = Math.ceil(image.width / 8);
    const bits = inflateSync(image.data);
    expect(bits.length).toBe(rowBytes * image.height);
    const row = bits.subarray(1000 * rowBytes, 1001 * rowBytes);
    expect(row[10]).toBe(0x00);
    expect(row[rowBytes - 10]).toBe(0xff);
  });

  test("halves the resolution for 150 DPI and recompresses other images as JPEG", async () => {
    const source = await jpeg(2400, 4000);
    const image = await preparePdfImage(source, "150", false);
    expect(image.kind).toBe("jpeg");
    const { width, height } = (await Jimp.read(Buffer.from(image.data))).bitmap;
    expect([width, height]).toEqual([1052, 1754]);
  });

  test("keeps the edited image when it is small enough or the original is requested", async () => {
    const small = await jpeg(800, 1000);
    expect(await preparePdfImage(small, "300", false)).toEqual({ kind: "jpeg", data: small });
    const large = await jpeg(2400, 4000);
    expect(await preparePdfImage(large, "original", true)).toEqual({ kind: "jpeg", data: large });
    expect((await preparePdfImage(small, "300", true)).kind).toBe("bilevel");
  });
});
