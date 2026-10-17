import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "./editSettings";
import { GRAY_MIX_PRESETS } from "./image/grayMix";
import { applyFixedSteps, describePreset, normalizePresetSteps, pickSteps, presetStepsFromSettings } from "./presets";
import type { DewarpGrid, EditSettings, Quad } from "./types";

const settings = (overrides: Partial<EditSettings>): EditSettings => ({ ...DEFAULT_EDIT_SETTINGS, ...overrides });
const grid = { rotation: 0, columns: 31, rows: 45, points: [] } as DewarpGrid;
const rect: Quad = [
  { x: 0.1, y: 0.2 },
  { x: 0.9, y: 0.2 },
  { x: 0.9, y: 0.8 },
  { x: 0.1, y: 0.8 },
];
const red = GRAY_MIX_PRESETS.find((p) => p.id === "red")!.mix;

describe("image presets", () => {
  test("keep only the settings that differ from the defaults", () => {
    expect(presetStepsFromSettings(DEFAULT_EDIT_SETTINGS)).toEqual({});
    expect(presetStepsFromSettings(settings({ brightness: -0.09, colorMode: "grayscale", saturation: 40, denoise: 2 }))).toEqual({
      brightness: -0.09,
      colorMode: "grayscale",
      denoise: 2,
    });
  });

  test("store automatic tools as steps and hand-drawn corners as a fixed crop", () => {
    const edited = settings({ rotation: 90, dewarp: { ...grid, rotation: 90 }, corners: rect, colorMode: "bw", brightness: 0.1, bwThreshold: 140 });
    expect(presetStepsFromSettings(edited)).toEqual({ rotation: 90, autoDewarp: true, crop: rect, colorMode: "bw", brightness: 0.1, bwThreshold: 140 });
    expect(presetStepsFromSettings(edited, { rotation: true, crop: true, bw: true })).toEqual({
      autoRotate: true,
      autoDewarp: true,
      autoCrop: true,
      autoBw: true,
    });
  });

  test("store the grayscale channels only in grayscale mode", () => {
    expect(presetStepsFromSettings(settings({ colorMode: "grayscale", grayMix: red }))).toEqual({ colorMode: "grayscale", grayMix: red });
    expect(presetStepsFromSettings(settings({ colorMode: "bw", grayMix: red }))).toEqual({ colorMode: "bw" });
  });

  test("describe fixed crops and grayscale channels", () => {
    expect(describePreset({ crop: rect, grayMix: red })).toBe("Fester Ausschnitt, Graustufen-Kanäle: Rotfilter");
    expect(describePreset({ crop: [rect[0], { x: 0.95, y: 0.1 }, rect[2], rect[3]] })).toBe("Feste Entzerrung");
  });

  test("describe their steps in the editor's words", () => {
    expect(describePreset({ autoBw: true, autoDewarp: true })).toBe("Automatisch entzerren, Automatisch SW");
    expect(describePreset({ brightness: -0.09, hue: 12, denoise: 1, rotation: 270 })).toBe("Drehung 270°, Helligkeit -9 %, Farbton +12°, Entrauschen: Leicht");
  });

  test("drop unknown values and the values an automatic step replaces", () => {
    expect(normalizePresetSteps({ autoBw: true, brightness: 0.2, bwThreshold: 300, contrast: "x", autoRotate: "ja", rotation: 45 })).toEqual({ autoBw: true });
    expect(normalizePresetSteps({ bwThreshold: 300.4, autoRotate: true, rotation: 90 })).toEqual({ bwThreshold: 255, autoRotate: true });
    expect(normalizePresetSteps({ crop: rect, autoCrop: true })).toEqual({ autoCrop: true });
    expect(normalizePresetSteps({ crop: [{ x: 0, y: 0 }], grayMix: { ...red, reds: 999 } })).toEqual({ grayMix: { ...red, reds: 300 } });
    expect(normalizePresetSteps({ grayMix: { reds: 10 } })).toEqual({});
  });

  test("pick the chosen steps and write fixed values onto settings", () => {
    const steps = { autoBw: true, denoise: 2, hue: 10 };
    expect(pickSteps(steps, ["denoise", "brightness"])).toEqual({ denoise: 2 });
    expect(applyFixedSteps(settings({ brightness: 0.3 }), steps)).toEqual(settings({ brightness: 0.3, denoise: 2, hue: 10 }));
    expect(applyFixedSteps(settings({}), { crop: rect, colorMode: "grayscale", grayMix: red })).toEqual(
      settings({ corners: rect, colorMode: "grayscale", grayMix: red }),
    );
  });
});
