import type { TFunction } from "i18next";
import { DEFAULT_EDIT_SETTINGS, normalizeQuad } from "./editSettings";
import { describeGrayMix, normalizeGrayMix } from "./image/grayMix";
import { isAxisAlignedRect } from "./image/perspective";
import { normalizeShapes, type Shape } from "./shapes";
import type { ColorMode, EditSettings, GrayMix, Quad, Rotation } from "./types";

/**
 * The edit steps an image preset applies. Automatic steps are worked out again for every image; the others set fixed
 * values. Settings left out stay as they are.
 */
export interface PresetSteps {
  autoRotate?: boolean;
  rotation?: Rotation;
  autoDewarp?: boolean;
  autoCrop?: boolean;
  /** Fixed crop or perspective corners, relative to the rotated (and dewarped) image like `EditSettings.corners`. */
  crop?: Quad;
  /** Picks brightness, contrast and threshold for black and white, like „Automatisch SW“. */
  autoBw?: boolean;
  colorMode?: ColorMode;
  grayMix?: GrayMix;
  /** Grayscale threshold, see `EditSettings.grayThreshold`. */
  grayThreshold?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  bwThreshold?: number;
  denoise?: number;
  autoLevels?: boolean;
  /** Rectangles drawn onto the edited image, relative to its size; they replace the image's shapes. */
  shapes?: Shape[];
}

export type PresetStep = keyof PresetSteps;

export interface ImagePreset {
  id: number;
  name: string;
  steps: PresetSteps;
  createdAt: string;
}

/** Created for every user and applied on import until they choose otherwise. */
export const DEFAULT_IMPORT_PRESET: { name: string; steps: PresetSteps } = {
  name: "OCR optimized",
  steps: { autoRotate: true, autoBw: true, autoLevels: true },
};

export interface ImagePresetInput {
  name?: string;
  steps?: PresetSteps;
}

/** Display order; also the order steps are listed in. */
export const PRESET_STEPS: PresetStep[] = [
  "autoRotate",
  "rotation",
  "autoDewarp",
  "autoCrop",
  "crop",
  "autoBw",
  "colorMode",
  "grayMix",
  "grayThreshold",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "bwThreshold",
  "autoLevels",
  "denoise",
  "shapes",
];

export const AUTO_STEPS: PresetStep[] = ["autoRotate", "autoDewarp", "autoCrop", "autoBw"];

/** Steps an automatic step replaces, because it sets those values itself. */
const REPLACED_BY: Partial<Record<PresetStep, PresetStep[]>> = {
  autoRotate: ["rotation"],
  autoCrop: ["crop"],
  autoBw: ["colorMode", "grayMix", "grayThreshold", "brightness", "contrast", "bwThreshold"],
};

const ROTATIONS: Rotation[] = [0, 90, 180, 270];
const COLOR_MODES: ColorMode[] = ["color", "grayscale", "bw"];

const number = (value: unknown, min: number, max: number, round = false): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(max, Math.max(min, value));
  return round ? Math.round(clamped) : clamped;
};

export function normalizePresetSteps(input: unknown): PresetSteps {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const steps: PresetSteps = {};
  for (const step of AUTO_STEPS) if (src[step] === true) steps[step as "autoRotate"] = true;
  if (ROTATIONS.includes(src.rotation as Rotation)) steps.rotation = src.rotation as Rotation;
  if (COLOR_MODES.includes(src.colorMode as ColorMode)) steps.colorMode = src.colorMode as ColorMode;
  const crop = normalizeQuad(src.crop);
  if (crop) steps.crop = crop;
  const grayMix = normalizeGrayMix(src.grayMix);
  if (grayMix) steps.grayMix = grayMix;
  const values = {
    brightness: number(src.brightness, -1, 1),
    contrast: number(src.contrast, -1, 1),
    saturation: number(src.saturation, -100, 100),
    hue: number(src.hue, -180, 180),
    grayThreshold: number(src.grayThreshold, 0, 255, true),
    bwThreshold: number(src.bwThreshold, 0, 255, true),
    denoise: number(src.denoise, 0, 3, true),
  };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) steps[key as "brightness"] = value;
  if (typeof src.autoLevels === "boolean") steps.autoLevels = src.autoLevels;
  const shapes = normalizeShapes(src.shapes);
  if (shapes.length > 0) steps.shapes = shapes;
  for (const [auto, replaced] of Object.entries(REPLACED_BY)) {
    if (steps[auto as PresetStep]) for (const step of replaced) delete steps[step];
  }
  return steps;
}

export function normalizePresetName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

/** Which of the current settings came from an automatic tool rather than being set by hand. */
export interface AutoApplied {
  rotation?: boolean;
  crop?: boolean;
  bw?: boolean;
}

/** The steps that reproduce the settings that differ from the defaults; hand-drawn corners become a fixed crop. */
export function presetStepsFromSettings(settings: EditSettings, auto: AutoApplied = {}): PresetSteps {
  const d = DEFAULT_EDIT_SETTINGS;
  const steps: PresetSteps = {};
  if (auto.rotation) steps.autoRotate = true;
  else if (settings.rotation !== d.rotation) steps.rotation = settings.rotation;
  if (settings.dewarp) steps.autoDewarp = true;
  if (settings.corners) {
    if (auto.crop) steps.autoCrop = true;
    else steps.crop = settings.corners;
  }
  if (auto.bw) steps.autoBw = true;
  else {
    if (settings.colorMode !== d.colorMode) steps.colorMode = settings.colorMode;
    if (settings.brightness !== d.brightness) steps.brightness = settings.brightness;
    if (settings.contrast !== d.contrast) steps.contrast = settings.contrast;
    if (settings.colorMode === "grayscale" && settings.grayMix) steps.grayMix = settings.grayMix;
    if (settings.colorMode === "grayscale" && settings.grayThreshold !== null) steps.grayThreshold = settings.grayThreshold;
    if (settings.colorMode === "bw" && settings.bwThreshold !== d.bwThreshold) steps.bwThreshold = settings.bwThreshold;
  }
  if (settings.autoLevels) steps.autoLevels = true;
  if (settings.colorMode === "color") {
    if (settings.saturation !== d.saturation) steps.saturation = settings.saturation;
    if (settings.hue !== d.hue) steps.hue = settings.hue;
  }
  if (settings.denoise !== d.denoise) steps.denoise = settings.denoise;
  return steps;
}

/** The steps' fixed values written onto `settings`; automatic steps need the image and are left to the server. */
export function applyFixedSteps(settings: EditSettings, steps: PresetSteps): EditSettings {
  const next = { ...settings };
  if (steps.crop) next.corners = steps.crop;
  for (const key of ["colorMode", "grayMix", "grayThreshold", "brightness", "contrast", "saturation", "hue", "bwThreshold", "denoise", "autoLevels"] as const) {
    if (steps[key] !== undefined) (next as Record<string, unknown>)[key] = steps[key];
  }
  return next;
}

export const DENOISE_LEVELS = ["off", "light", "medium", "strong"] as const;

export const formatPercent = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`;
export const formatSigned = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;

export function describeStep(t: TFunction, steps: PresetSteps, step: PresetStep): string {
  switch (step) {
    case "rotation":
      return t("presetSteps.rotation", { value: steps.rotation });
    case "crop":
      return isAxisAlignedRect(steps.crop!) ? t("presetSteps.cropRect") : t("presetSteps.cropQuad");
    case "colorMode":
      return t(`colorModes.${steps.colorMode!}`);
    case "grayMix":
      return t("presetSteps.grayMix", { value: describeGrayMix(t, steps.grayMix!) });
    case "grayThreshold":
      return t("presetSteps.grayThreshold", { value: steps.grayThreshold });
    case "brightness":
      return t("presetSteps.brightness", { value: formatPercent(steps.brightness!) });
    case "contrast":
      return t("presetSteps.contrast", { value: formatPercent(steps.contrast!) });
    case "saturation":
      return t("presetSteps.saturation", { value: formatSigned(steps.saturation!) });
    case "hue":
      return t("presetSteps.hue", { value: formatSigned(steps.hue!) });
    case "bwThreshold":
      return t("presetSteps.bwThreshold", { value: steps.bwThreshold });
    case "autoLevels":
      return steps.autoLevels ? t("presetSteps.autoLevels") : t("presetSteps.manualLevels");
    case "denoise":
      return t("presetSteps.denoise", { value: t(`denoise.${DENOISE_LEVELS[steps.denoise!]}`) });
    case "shapes":
      return t("presetSteps.shapes", { count: steps.shapes!.length });
    default:
      return t(`presetSteps.${step}`);
  }
}

export function presetStepList(steps: PresetSteps): PresetStep[] {
  return PRESET_STEPS.filter((step) => steps[step] !== undefined);
}

/** E.g. "Automatisch entzerren, Automatisch SW". */
export function describePreset(t: TFunction, steps: PresetSteps): string {
  return presetStepList(steps)
    .map((step) => describeStep(t, steps, step))
    .join(", ");
}

export function pickSteps(steps: PresetSteps, chosen: PresetStep[]): PresetSteps {
  return Object.fromEntries(chosen.filter((step) => steps[step] !== undefined).map((step) => [step, steps[step]])) as PresetSteps;
}
