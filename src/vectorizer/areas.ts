import { normalizeVectorSettings, REFERENCE_SIZE } from "./settings";
import type { VectorArea, VectorGraphic, VectorPath } from "./types";

export const MAX_VECTOR_AREAS = 50;
/** Smaller areas are dropped (e.g. a click without dragging). */
export const MIN_AREA_SIZE = 0.005;
/** Longest side of the pixels that are vectorized; larger areas are scaled down first. */
export const MAX_VECTORIZE_SIZE = 2400;
/** Characters of path data per area. */
export const MAX_PATH_DATA = 6_000_000;
const MAX_GRAPHIC_SIZE = 10_000;

const COLOR = /^#[0-9a-f]{6}$/;
// What the backends write: absolute commands, decimal numbers. Anything else is rejected rather than rendered.
const PATH = /^[MLCZ0-9 .-]+$/;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function normalizeGraphic(value: unknown): VectorGraphic | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const size = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= MAX_GRAPHIC_SIZE;
  if (!size(src.width) || !size(src.height) || !Array.isArray(src.paths)) return null;
  const background = typeof src.background === "string" ? src.background.toLowerCase() : "";
  if (!COLOR.test(background)) return null;
  const paths: VectorPath[] = [];
  let length = 0;
  for (const item of src.paths) {
    if (!item || typeof item !== "object") return null;
    const { d, fill } = item as Record<string, unknown>;
    if (typeof d !== "string" || typeof fill !== "string" || !PATH.test(d) || !COLOR.test(fill.toLowerCase())) return null;
    length += d.length;
    if (length > MAX_PATH_DATA) return null;
    paths.push({ d, fill: fill.toLowerCase() });
  }
  return { width: src.width as number, height: src.height as number, background, paths };
}

/** Valid areas only; graphics that are malformed or too large become null (not vectorized). */
export function normalizeVectorAreas(value: unknown): VectorArea[] {
  if (!Array.isArray(value)) return [];
  const areas: VectorArea[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, MAX_VECTOR_AREAS)) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    const numbers = [src.x, src.y, src.width, src.height];
    if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const x = clamp01(src.x as number);
    const y = clamp01(src.y as number);
    const width = Math.min(1 - x, Math.max(0, src.width as number));
    const height = Math.min(1 - y, Math.max(0, src.height as number));
    if (width < MIN_AREA_SIZE || height < MIN_AREA_SIZE) continue;
    let id = typeof src.id === "string" && src.id.length > 0 && src.id.length <= 64 ? src.id : `v${areas.length + 1}`;
    while (ids.has(id)) id = `${id}-${areas.length}`;
    ids.add(id);
    areas.push({ id, x, y, width, height, settings: normalizeVectorSettings(src.settings), graphic: normalizeGraphic(src.graphic) });
  }
  return areas;
}

/** The pixel rectangle of an area in an image of the given size. */
export function areaPixels(area: Pick<VectorArea, "x" | "y" | "width" | "height">, width: number, height: number) {
  const left = Math.max(0, Math.round(area.x * width));
  const top = Math.max(0, Math.round(area.y * height));
  const right = Math.min(width, Math.round((area.x + area.width) * width));
  const bottom = Math.min(height, Math.round((area.y + area.height) * height));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export interface RegionPlan {
  /** Source rectangle in pixels of the image. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Size the region is vectorized at (scaled down to `MAX_VECTORIZE_SIZE`). */
  outWidth: number;
  outHeight: number;
  /** Pixels of the vectorized region per pixel of a 300 DPI A4 page. */
  pixelScale: number;
}

export function regionPlan(area: Pick<VectorArea, "x" | "y" | "width" | "height">, imageWidth: number, imageHeight: number): RegionPlan | null {
  const rect = areaPixels(area, imageWidth, imageHeight);
  if (rect.width === 0 || rect.height === 0) return null;
  const factor = Math.min(1, MAX_VECTORIZE_SIZE / Math.max(rect.width, rect.height));
  return {
    ...rect,
    outWidth: Math.max(1, Math.round(rect.width * factor)),
    outHeight: Math.max(1, Math.round(rect.height * factor)),
    pixelScale: (Math.max(imageWidth, imageHeight) / REFERENCE_SIZE) * factor,
  };
}
