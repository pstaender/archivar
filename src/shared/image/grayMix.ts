import type { GrayMix } from "../types";

export const GRAY_MIX_CHANNELS: { key: keyof GrayMix; label: string }[] = [
  { key: "reds", label: "Rottöne" },
  { key: "yellows", label: "Gelbtöne" },
  { key: "greens", label: "Grüntöne" },
  { key: "cyans", label: "Cyantöne" },
  { key: "blues", label: "Blautöne" },
  { key: "magentas", label: "Magentatöne" },
];

export const GRAY_MIX_MIN = -200;
export const GRAY_MIX_MAX = 300;

/**
 * The plain brightness conversion (Rec. 601 luma) expressed as a mix: a secondary colour weighs the sum of its two
 * channels, so with these weights `mixGray` gives the same result as no mix (up to rounding).
 */
export const LUMA_GRAY_MIX: GrayMix = { reds: 30, yellows: 89, greens: 59, cyans: 70, blues: 11, magentas: 41 };

/** Named mixes offered in the editor besides the plain conversion ("luma", stored as no mix). */
export const GRAY_MIX_PRESETS: { id: string; label: string; mix: GrayMix }[] = [
  { id: "balanced", label: "Ausgewogen", mix: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 } },
  { id: "red", label: "Rotfilter", mix: { reds: 120, yellows: 110, greens: -10, cyans: -50, blues: -50, magentas: 120 } },
  { id: "yellow", label: "Gelbfilter", mix: { reds: 120, yellows: 110, greens: 40, cyans: -30, blues: -50, magentas: 90 } },
  { id: "green", label: "Grünfilter", mix: { reds: -10, yellows: 100, greens: 120, cyans: 70, blues: -30, magentas: -50 } },
  { id: "blue", label: "Blaufilter", mix: { reds: -50, yellows: -50, greens: -10, cyans: 110, blues: 120, magentas: 90 } },
];


export function normalizeGrayMix(value: unknown): GrayMix | null {
  if (!value || typeof value !== "object") return null;
  const src = value as Record<string, unknown>;
  const mix = {} as GrayMix;
  for (const { key } of GRAY_MIX_CHANNELS) {
    const n = src[key];
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
    mix[key] = Math.round(Math.min(GRAY_MIX_MAX, Math.max(GRAY_MIX_MIN, n)));
  }
  return mix;
}

const sameMix = (a: GrayMix, b: GrayMix) => GRAY_MIX_CHANNELS.every(({ key }) => a[key] === b[key]);

export function grayMixPresetId(mix: GrayMix | null): string | null {
  if (!mix || sameMix(mix, LUMA_GRAY_MIX)) return "luma";
  return GRAY_MIX_PRESETS.find((preset) => sameMix(preset.mix, mix))?.id ?? null;
}

export function describeGrayMix(mix: GrayMix): string {
  if (grayMixPresetId(mix) === "luma") return "Standard";
  const preset = GRAY_MIX_PRESETS.find((p) => p.id === grayMixPresetId(mix));
  return preset ? preset.label : GRAY_MIX_CHANNELS.map(({ key, label }) => `${label.slice(0, 2)} ${mix[key]}`).join(" ");
}

/**
 * Grayscale with a weight per hue, like Photoshop's „Schwarzweiß“ adjustment: the part of a pixel above its smallest
 * channel is split into a primary colour (largest channel) and a secondary one (the two largest channels), each
 * brightened or darkened by its weight in percent. Neutral grays stay unchanged.
 */
export function mixGray(data: Uint8Array | Uint8ClampedArray, mix: GrayMix): void {
  const w = {
    r: mix.reds / 100,
    g: mix.greens / 100,
    b: mix.blues / 100,
    rg: mix.yellows / 100,
    gb: mix.cyans / 100,
    rb: mix.magentas / 100,
  };
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    let max: number, mid: number, min: number, primary: number, secondary: number;
    if (r >= g && r >= b) {
      max = r;
      primary = w.r;
      mid = g >= b ? g : b;
      min = g >= b ? b : g;
      secondary = g >= b ? w.rg : w.rb;
    } else if (g >= b) {
      max = g;
      primary = w.g;
      mid = r >= b ? r : b;
      min = r >= b ? b : r;
      secondary = r >= b ? w.rg : w.gb;
    } else {
      max = b;
      primary = w.b;
      mid = r >= g ? r : g;
      min = r >= g ? g : r;
      secondary = r >= g ? w.rb : w.gb;
    }
    const v = Math.min(255, Math.max(0, Math.round(min + (max - mid) * primary + (mid - min) * secondary)));
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}
