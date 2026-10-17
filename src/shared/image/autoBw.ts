import type { BwVariant, EditSettings } from "../types";
import type { JimpImage } from "./jimp";
import { applyEdits, applyTone, luma, scaleToFit } from "./pipeline";

const ANALYSIS_SIZE = 1024;
const STRETCH_CLIP = 0.01;
const MIN_RANGE = 16;
const MIN_CLASS_SEPARATION = 40;
const MIN_THRESHOLD_DISTANCE = 12;

export type Histogram = number[];

export function lumaHistogram(image: JimpImage): Histogram {
  const hist = new Array<number>(256).fill(0);
  const data = image.bitmap.data;
  for (let i = 0; i < data.length; i += 4) hist[Math.min(255, Math.floor(luma(data, i)))]!++;
  return hist;
}

function total(hist: Histogram): number {
  return hist.reduce((sum, n) => sum + n, 0);
}

export function percentile(hist: Histogram, p: number): number {
  const target = total(hist) * p;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v]!;
    if (seen > target) return v;
  }
  return 255;
}

/** Brightness/contrast that map `low` to black and `high` to white with the pipeline's tone operators. */
export function stretchTone(low: number, high: number): Pick<BwVariant, "brightness" | "contrast"> {
  if (high - low < MIN_RANGE) return { brightness: 0, contrast: 0 };
  const gain = 255 / (high - low);
  const factor = 1 + (gain * low) / 127;
  const brightness = Math.min(1, Math.max(-1, gain / factor - 1));
  const contrast = Math.min(0.99, Math.max(0, (factor - 1) / (factor + 1)));
  return { brightness: round2(brightness), contrast: round2(contrast) };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// All thresholds follow binarize(): values >= threshold become white.

export function otsuThreshold(hist: Histogram): number {
  const n = total(hist);
  const sumAll = hist.reduce((sum, count, v) => sum + count * v, 0);
  let weightDark = 0;
  let sumDark = 0;
  let best = 128;
  let bestVariance = -1;
  for (let v = 0; v < 255; v++) {
    weightDark += hist[v]!;
    if (weightDark === 0) continue;
    const weightLight = n - weightDark;
    if (weightLight === 0) break;
    sumDark += v * hist[v]!;
    const meanDark = sumDark / weightDark;
    const meanLight = (sumAll - sumDark) / weightLight;
    const variance = weightDark * weightLight * (meanDark - meanLight) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = v + 1;
    }
  }
  return best;
}

function modeBetween(hist: Histogram, from: number, to: number): number {
  let mode = from;
  for (let v = from; v < to; v++) if (hist[v]! > hist[mode]!) mode = v;
  return mode;
}

function classSeparation(hist: Histogram, threshold: number): number {
  const mean = (from: number, to: number) => {
    let count = 0;
    let sum = 0;
    for (let v = from; v < to; v++) {
      count += hist[v]!;
      sum += v * hist[v]!;
    }
    return count > 0 ? sum / count : from;
  };
  return mean(threshold, 256) - mean(0, threshold);
}

export function distinctThresholds(candidates: number[]): number[] {
  const result: number[] = [];
  for (const raw of candidates) {
    const t = Math.min(254, Math.max(1, Math.round(raw)));
    if (result.every((kept) => Math.abs(kept - t) >= MIN_THRESHOLD_DISTANCE)) result.push(t);
  }
  return result;
}

/**
 * Black-and-white variants for the image after geometry and denoise: the Otsu threshold as best guess,
 * then one closer to the paper level (keeps faint lines) and one closer to the ink level (less noise).
 * Brightness/contrast stretch the luma range so that the variants differ only in their threshold.
 * Pages without distinct ink are not stretched, otherwise paper noise would turn into speckles.
 * With `autoLevels` the analysis starts from the normalized image, as the pipeline normalizes before brightness/contrast.
 */
export function autoBwVariants(source: JimpImage, settings: EditSettings): BwVariant[] {
  const prepared = applyEdits(scaleToFit(source.clone() as JimpImage, ANALYSIS_SIZE), {
    ...settings,
    brightness: 0,
    contrast: 0,
    colorMode: "color",
    saturation: 0,
    hue: 0,
  });
  const base = lumaHistogram(prepared);
  if (classSeparation(base, otsuThreshold(base)) < MIN_CLASS_SEPARATION) {
    return distinctThresholds([percentile(base, STRETCH_CLIP), otsuThreshold(base)]).map((bwThreshold) => ({ brightness: 0, contrast: 0, bwThreshold }));
  }
  const tone = stretchTone(percentile(base, STRETCH_CLIP), percentile(base, 1 - STRETCH_CLIP));
  applyTone(prepared, { ...tone, autoLevels: false });
  const hist = lumaHistogram(prepared);

  const otsu = otsuThreshold(hist);
  const paper = modeBetween(hist, otsu, 256);
  const ink = modeBetween(hist, 0, otsu);
  const thresholds = distinctThresholds([otsu, (otsu + paper) / 2, (otsu + ink) / 2]);
  return thresholds.map((bwThreshold) => ({ ...tone, bwThreshold }));
}
