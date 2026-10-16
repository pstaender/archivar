import { deflateSync } from "node:zlib";
import type { PdfImageQuality } from "../../shared/settings";

const A4_LONG_SIDE_INCHES = 11.69;
// Lower resolutions show compression artifacts sooner, so they get a higher quality.
const JPEG_QUALITY: Record<Exclude<PdfImageQuality, "original">, number> = { "300": 75, "150": 80 };
const BILEVEL_THRESHOLD = 128;

export type PdfImage =
  | { kind: "jpeg"; data: Uint8Array }
  /** Rows of 1-bit pixels (1 = white), each padded to a full byte and compressed with Flate. */
  | { kind: "bilevel"; width: number; height: number; data: Uint8Array };

/**
 * Scales the edited image down to the requested resolution on an A4 page. Black-and-white images become lossless
 * 1-bit images (a text page at 300 DPI is about 150–200 KB, without the halos JPEG leaves around letters); others are
 * recompressed as JPEG, unless they are already small enough.
 */
export async function preparePdfImage(jpeg: Uint8Array, quality: PdfImageQuality, bilevel: boolean): Promise<PdfImage> {
  if (quality === "original") return { kind: "jpeg", data: jpeg };
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(Buffer.from(jpeg));
  const scale = Math.min(1, Math.round(A4_LONG_SIDE_INCHES * Number(quality)) / Math.max(image.width, image.height));
  if (scale === 1 && !bilevel) return { kind: "jpeg", data: jpeg };

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  if (!bilevel) return { kind: "jpeg", data: await canvas.encode("jpeg", JPEG_QUALITY[quality]) };
  return { kind: "bilevel", width, height, data: deflateSync(packBits(ctx.getImageData(0, 0, width, height).data, width, height), { level: 9 }) };
}

function packBits(rgba: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
      if (luma >= BILEVEL_THRESHOLD) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return bits;
}
