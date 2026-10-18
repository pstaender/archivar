import type { EditSettings } from "./types";

/** A filled rectangle; position and size are relative (0..1) to the edited image it is drawn on. */
export interface RectShape {
  id: string;
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** "#rrggbb" */
  color: string;
}

export type Shape = RectShape;

/** As stored on the document: the shapes and the geometry of the edited image they were drawn on. */
export interface ShapeLayer {
  shapes: Shape[];
  geometry: string;
}

export const MAX_SHAPES = 500;
/** Smaller rectangles are dropped (e.g. a click without dragging). */
export const MIN_SHAPE_SIZE = 0.002;

export const SHAPE_COLORS: { color: string; name: "black" | "white" }[] = [
  { color: "#000000", name: "black" },
  { color: "#ffffff", name: "white" },
];

const COLOR = /^#[0-9a-f]{6}$/;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function normalizeShapeColor(value: unknown): string | null {
  const color = typeof value === "string" ? value.trim().toLowerCase() : "";
  return COLOR.test(color) ? color : null;
}

export function normalizeShapes(value: unknown): Shape[] {
  if (!Array.isArray(value)) return [];
  const shapes: Shape[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, MAX_SHAPES)) {
    if (!item || typeof item !== "object") continue;
    const src = item as Record<string, unknown>;
    if (src.type !== "rect") continue;
    const numbers = [src.x, src.y, src.width, src.height];
    if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const color = normalizeShapeColor(src.color);
    if (!color) continue;
    const x = clamp01(src.x as number);
    const y = clamp01(src.y as number);
    const width = Math.min(1 - x, Math.max(0, src.width as number));
    const height = Math.min(1 - y, Math.max(0, src.height as number));
    if (width < MIN_SHAPE_SIZE || height < MIN_SHAPE_SIZE) continue;
    let id = typeof src.id === "string" && src.id.length > 0 && src.id.length <= 64 ? src.id : `s${shapes.length + 1}`;
    while (ids.has(id)) id = `${id}-${shapes.length}`;
    ids.add(id);
    shapes.push({ id, type: "rect", x, y, width, height, color });
  }
  return shapes;
}

/** Changes of these settings move the image content under the shapes. */
export function shapeGeometry(settings: EditSettings): string {
  return JSON.stringify({ rotation: settings.rotation, corners: settings.corners, dewarp: settings.dewarp !== null });
}

/** Paints the rectangles opaquely into RGBA pixels. */
export function drawShapes(image: { data: Uint8Array | Uint8ClampedArray; width: number; height: number }, shapes: Shape[]): void {
  const { data, width, height } = image;
  for (const shape of shapes) {
    const r = parseInt(shape.color.slice(1, 3), 16);
    const g = parseInt(shape.color.slice(3, 5), 16);
    const b = parseInt(shape.color.slice(5, 7), 16);
    const x0 = Math.max(0, Math.round(shape.x * width));
    const y0 = Math.max(0, Math.round(shape.y * height));
    const x1 = Math.min(width, Math.round((shape.x + shape.width) * width));
    const y1 = Math.min(height, Math.round((shape.y + shape.height) * height));
    for (let y = y0; y < y1; y++) {
      for (let i = (y * width + x0) * 4, end = (y * width + x1) * 4; i < end; i += 4) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
  }
}
