import type { RgbaImage, VectorSettings } from "./types";

export const MIN_DETAIL = 1;
export const MAX_DETAIL = 5;

export const DEFAULT_VECTOR_SETTINGS: VectorSettings = { mode: "color", detail: 3, curves: "smooth", threshold: 128 };

/** Long side of an A4 page at 300 DPI, the resolution the detail levels are tuned for. */
export const REFERENCE_SIZE = 3508;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function normalizeVectorSettings(value: unknown): VectorSettings {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (n: unknown, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? n : fallback);
  return {
    mode: src.mode === "bw" ? "bw" : "color",
    detail: Math.round(clamp(number(src.detail, DEFAULT_VECTOR_SETTINGS.detail), MIN_DETAIL, MAX_DETAIL)),
    curves: src.curves === "sharp" ? "sharp" : "smooth",
    threshold: Math.round(clamp(number(src.threshold, DEFAULT_VECTOR_SETTINGS.threshold), 1, 254)),
  };
}

/** Otsu's threshold of a 256-bin histogram; the middle of the gap when dark and light pixels are clearly apart. */
function otsu(histogram: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i]!;
  let sumBelow = 0;
  let below = 0;
  let best = 0;
  let first = 127;
  let last = 127;
  for (let t = 0; t < 256; t++) {
    below += histogram[t]!;
    sumBelow += t * histogram[t]!;
    if (below === 0) continue;
    const above = total - below;
    if (above === 0) break;
    const between = below * above * (sumBelow / below - (sum - sumBelow) / above) ** 2;
    if (between > best * (1 + 1e-9)) {
      best = between;
      first = last = t;
    } else if (between >= best * (1 - 1e-9)) last = t;
  }
  return Math.round((first + last) / 2) + 1;
}

/**
 * Settings that suit the area: black and white when it has hardly any color or mid tones (text, line art, B/W
 * scans), the threshold between its dark and light pixels, and less detail for photo-like areas with many colors and
 * more for small or low-resolution ones, where every pixel counts.
 */
export function suggestVectorSettings(image: RgbaImage, pixelScale: number): VectorSettings {
  const { width, height, data } = image;
  const pixels = width * height;
  const step = Math.max(1, Math.floor(pixels / 250_000));
  const histogram = new Array<number>(256).fill(0);
  const colors = new Set<number>();
  let chroma = 0;
  let midTones = 0;
  let count = 0;
  for (let i = 0; i < pixels; i += step) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const luma = Math.floor((r + g + b) / 3);
    histogram[luma]!++;
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
    if (luma >= 64 && luma <= 192) midTones++;
    colors.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    count++;
  }
  const gray = chroma / count < 12;
  const bw = gray && midTones / count < 0.2;
  let detail = DEFAULT_VECTOR_SETTINGS.detail;
  if (!bw && colors.size > 600) detail--;
  if (Math.min(width, height) / Math.max(pixelScale, 0.25) < 200 || pixelScale < 0.6) detail++;
  return { mode: bw ? "bw" : "color", detail: clamp(detail, MIN_DETAIL, MAX_DETAIL), curves: "smooth", threshold: clamp(otsu(histogram, count), 1, 254) };
}
