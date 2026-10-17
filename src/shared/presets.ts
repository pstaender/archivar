import { DEFAULT_EDIT_SETTINGS } from "./editSettings";
import type { ColorMode, EditSettings, Rotation } from "./types";

/**
 * The edit steps an image preset applies. Automatic steps are worked out again for every image; the others set fixed
 * values. Settings left out stay as they are.
 */
export interface PresetSteps {
  autoRotate?: boolean;
  rotation?: Rotation;
  autoDewarp?: boolean;
  autoCrop?: boolean;
  /** Picks brightness, contrast and threshold for black and white, like „Automatisch SW“. */
  autoBw?: boolean;
  colorMode?: ColorMode;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  bwThreshold?: number;
  denoise?: number;
  autoLevels?: boolean;
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
  name: "SW + Auto-Tonwerte + automatisch drehen",
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
  "autoBw",
  "colorMode",
  "brightness",
  "contrast",
  "saturation",
  "hue",
  "bwThreshold",
  "autoLevels",
  "denoise",
];

export const AUTO_STEPS: PresetStep[] = ["autoRotate", "autoDewarp", "autoCrop", "autoBw"];

/** Steps an automatic step replaces, because it sets those values itself. */
const REPLACED_BY: Partial<Record<PresetStep, PresetStep[]>> = {
  autoRotate: ["rotation"],
  autoBw: ["colorMode", "brightness", "contrast", "bwThreshold"],
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
  const values = {
    brightness: number(src.brightness, -1, 1),
    contrast: number(src.contrast, -1, 1),
    saturation: number(src.saturation, -100, 100),
    hue: number(src.hue, -180, 180),
    bwThreshold: number(src.bwThreshold, 0, 255, true),
    denoise: number(src.denoise, 0, 3, true),
  };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) steps[key as "brightness"] = value;
  if (typeof src.autoLevels === "boolean") steps.autoLevels = src.autoLevels;
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

/** The steps that reproduce the settings that differ from the defaults; hand-drawn crops cannot be reused and are left out. */
export function presetStepsFromSettings(settings: EditSettings, auto: AutoApplied = {}): PresetSteps {
  const d = DEFAULT_EDIT_SETTINGS;
  const steps: PresetSteps = {};
  if (auto.rotation) steps.autoRotate = true;
  else if (settings.rotation !== d.rotation) steps.rotation = settings.rotation;
  if (settings.dewarp) steps.autoDewarp = true;
  if (settings.corners && auto.crop) steps.autoCrop = true;
  if (auto.bw) steps.autoBw = true;
  else {
    if (settings.colorMode !== d.colorMode) steps.colorMode = settings.colorMode;
    if (settings.brightness !== d.brightness) steps.brightness = settings.brightness;
    if (settings.contrast !== d.contrast) steps.contrast = settings.contrast;
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
  for (const key of ["colorMode", "brightness", "contrast", "saturation", "hue", "bwThreshold", "denoise", "autoLevels"] as const) {
    if (steps[key] !== undefined) (next as Record<string, unknown>)[key] = steps[key];
  }
  return next;
}

const COLOR_MODE_LABELS: Record<ColorMode, string> = { color: "Farbe", grayscale: "Graustufen", bw: "S/W" };
export const DENOISE_LABELS = ["Aus", "Leicht", "Mittel", "Stark"];

export const formatPercent = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`;
export const formatSigned = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;

export function describeStep(steps: PresetSteps, step: PresetStep): string {
  switch (step) {
    case "autoRotate":
      return "Automatisch drehen";
    case "rotation":
      return `Drehung ${steps.rotation}°`;
    case "autoDewarp":
      return "Automatisch entzerren";
    case "autoCrop":
      return "Auto-Zuschnitt";
    case "autoBw":
      return "Automatisch SW";
    case "colorMode":
      return COLOR_MODE_LABELS[steps.colorMode!];
    case "brightness":
      return `Helligkeit ${formatPercent(steps.brightness!)}`;
    case "contrast":
      return `Kontrast ${formatPercent(steps.contrast!)}`;
    case "saturation":
      return `Sättigung ${formatSigned(steps.saturation!)}`;
    case "hue":
      return `Farbton ${formatSigned(steps.hue!)}°`;
    case "bwThreshold":
      return `Schwelle ${steps.bwThreshold}`;
    case "autoLevels":
      return steps.autoLevels ? "Auto-Tonwerte" : "Tonwerte manuell";
    case "denoise":
      return `Entrauschen: ${DENOISE_LABELS[steps.denoise!]}`;
  }
}

export function presetStepList(steps: PresetSteps): PresetStep[] {
  return PRESET_STEPS.filter((step) => steps[step] !== undefined);
}

/** E.g. "Automatisch entzerren, Automatisch SW". */
export function describePreset(steps: PresetSteps): string {
  return presetStepList(steps)
    .map((step) => describeStep(steps, step))
    .join(", ");
}

export function pickSteps(steps: PresetSteps, chosen: PresetStep[]): PresetSteps {
  return Object.fromEntries(chosen.filter((step) => steps[step] !== undefined).map((step) => [step, steps[step]])) as PresetSteps;
}
