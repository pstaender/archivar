import { normalizeGrayMix } from "./image/grayMix";
import type { ColorMode, DewarpGrid, EditSettings, Point, Quad, Rotation } from "./types";

export const DEFAULT_EDIT_SETTINGS: EditSettings = Object.freeze({
  rotation: 0,
  dewarp: null,
  corners: null,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  colorMode: "color",
  grayMix: null,
  grayThreshold: null,
  bwThreshold: 128,
  denoise: 0,
  autoLevels: false,
});

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const COLOR_MODES: ColorMode[] = ["color", "grayscale", "bw"];

export const FULL_QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizePoint(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;
  const { x, y } = value as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp(x, 0, 1, 0), y: clamp(y, 0, 1, 0) };
}

export function normalizeQuad(value: unknown): Quad | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const points = value.map(normalizePoint);
  if (points.some((p) => p === null)) return null;
  const quad = points as Quad;
  return isFullQuad(quad) ? null : quad;
}

export function isFullQuad(quad: Quad): boolean {
  return quad.every((p, i) => {
    const full = FULL_QUAD[i]!;
    return Math.abs(p.x - full.x) < 1e-6 && Math.abs(p.y - full.y) < 1e-6;
  });
}

export const DEWARP_GRID_COLUMNS = 31;
export const DEWARP_GRID_ROWS = 45;

export function normalizeDewarpGrid(value: unknown): DewarpGrid | null {
  if (!value || typeof value !== "object") return null;
  const { rotation, columns, rows, points } = value as Record<string, unknown>;
  if (!ROTATIONS.includes(rotation as Rotation)) return null;
  if (columns !== DEWARP_GRID_COLUMNS || rows !== DEWARP_GRID_ROWS || !Array.isArray(points)) return null;
  if (points.length !== 2 * DEWARP_GRID_COLUMNS * DEWARP_GRID_ROWS) return null;
  if (!points.every((p) => typeof p === "number" && Number.isFinite(p) && Math.abs(p) <= 2)) return null;
  return { rotation: rotation as Rotation, columns, rows, points: points as number[] };
}

export function normalizeEditSettings(input: unknown, base: EditSettings = DEFAULT_EDIT_SETTINGS): EditSettings {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rotation = ROTATIONS.includes(src.rotation as Rotation) ? (src.rotation as Rotation) : base.rotation;
  const colorMode = COLOR_MODES.includes(src.colorMode as ColorMode) ? (src.colorMode as ColorMode) : base.colorMode;
  const dewarp = "dewarp" in src ? normalizeDewarpGrid(src.dewarp) : base.dewarp;
  return {
    rotation,
    dewarp: dewarp && dewarp.rotation === rotation ? dewarp : null,
    corners: "corners" in src ? normalizeQuad(src.corners) : base.corners,
    brightness: clamp(src.brightness ?? base.brightness, -1, 1, base.brightness),
    contrast: clamp(src.contrast ?? base.contrast, -1, 1, base.contrast),
    saturation: clamp(src.saturation ?? base.saturation, -100, 100, base.saturation),
    hue: clamp(src.hue ?? base.hue, -180, 180, base.hue),
    colorMode,
    grayMix: "grayMix" in src ? normalizeGrayMix(src.grayMix) : base.grayMix,
    grayThreshold: "grayThreshold" in src ? normalizeThreshold(src.grayThreshold) : base.grayThreshold,
    bwThreshold: Math.round(clamp(src.bwThreshold ?? base.bwThreshold, 0, 255, base.bwThreshold)),
    denoise: Math.round(clamp(src.denoise ?? base.denoise, 0, 3, base.denoise)),
    autoLevels: typeof src.autoLevels === "boolean" ? src.autoLevels : base.autoLevels,
  };
}

function normalizeThreshold(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(255, Math.max(0, value))) : null;
}

/** Whether the edited image only has black and white pixels: S/W, or grayscale with a threshold. */
export function isBlackAndWhite(settings: EditSettings): boolean {
  return settings.colorMode === "bw" || (settings.colorMode === "grayscale" && settings.grayThreshold !== null);
}

export function isDefaultEditSettings(settings: EditSettings): boolean {
  return JSON.stringify(normalizeEditSettings(settings)) === JSON.stringify(DEFAULT_EDIT_SETTINGS);
}

export function rotateBy(rotation: Rotation, delta: 90 | -90): Rotation {
  return (((rotation + delta) % 360) + 360) % 360 as Rotation;
}
