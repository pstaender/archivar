import { deflateSync } from "node:zlib";
import type { Canvas } from "@napi-rs/canvas";
import type { PdfQuality } from "../../shared/settings";

const A4_LONG_SIDE_INCHES = 11.69;
const BILEVEL_THRESHOLD = 128;

/** Resolution on an A4 page (null: full resolution) and JPEG quality (null: lossless). */
interface Profile {
  dpi: number | null;
  jpeg: number | null;
}

// Lower resolutions show compression artifacts sooner, so "low" does not compress much harder than "medium".
const PROFILES: Record<Exclude<PdfQuality, number>, Profile> = {
  low: { dpi: 150, jpeg: 65 },
  medium: { dpi: 300, jpeg: 75 },
  high: { dpi: 600, jpeg: 90 },
  original: { dpi: null, jpeg: null },
};

export function pdfImageProfile(quality: PdfQuality): Profile {
  return typeof quality === "number" ? { dpi: 300, jpeg: Math.round(5 + quality * 9.5) } : PROFILES[quality];
}

export type PdfImage =
  | { kind: "jpeg"; data: Uint8Array }
  | { kind: "png"; data: Uint8Array }
  /** Rows of 1-bit pixels (1 = white), each padded to a full byte and compressed with Flate. */
  | { kind: "bilevel"; width: number; height: number; data: Uint8Array };

/**
 * Scales the edited image down to the quality's resolution on an A4 page. Black-and-white images become lossless
 * 1-bit images (a text page at 300 DPI is about 150–200 KB, without the halos JPEG leaves around letters); others
 * become JPEGs, or PNGs for "original".
 */
export async function preparePdfImage(source: Canvas, quality: PdfQuality, bilevel: boolean): Promise<PdfImage> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const { dpi, jpeg } = pdfImageProfile(quality);
  const scale = dpi === null ? 1 : Math.min(1, Math.round(A4_LONG_SIDE_INCHES * dpi) / Math.max(source.width, source.height));
  let canvas = source;
  if (scale < 1) {
    canvas = createCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }
  const { width, height } = canvas;
  if (bilevel) {
    const pixels = canvas.getContext("2d").getImageData(0, 0, width, height).data;
    return { kind: "bilevel", width, height, data: deflateSync(packBits(pixels, width, height), { level: 9 }) };
  }
  if (jpeg === null) return { kind: "png", data: await canvas.encode("png") };
  return { kind: "jpeg", data: await canvas.encode("jpeg", jpeg) };
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
