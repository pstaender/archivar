import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS, FULL_QUAD } from "./editSettings";
import { applyFixedSteps, describePreset, normalizePresetSteps, pickSteps, presetStepsFromSettings } from "./presets";
import type { DewarpGrid, EditSettings } from "./types";

const settings = (overrides: Partial<EditSettings>): EditSettings => ({ ...DEFAULT_EDIT_SETTINGS, ...overrides });
const grid = { rotation: 0, columns: 31, rows: 45, points: [] } as DewarpGrid;

describe("image presets", () => {
  test("keep only the settings that differ from the defaults", () => {
    expect(presetStepsFromSettings(DEFAULT_EDIT_SETTINGS)).toEqual({});
    expect(presetStepsFromSettings(settings({ brightness: -0.09, colorMode: "grayscale", saturation: 40, denoise: 2 }))).toEqual({
      brightness: -0.09,
      colorMode: "grayscale",
      denoise: 2,
    });
  });

  test("store automatic tools as steps and leave hand-drawn crops out", () => {
    const edited = settings({ rotation: 90, dewarp: { ...grid, rotation: 90 }, corners: FULL_QUAD, colorMode: "bw", brightness: 0.1, bwThreshold: 140 });
    expect(presetStepsFromSettings(edited)).toEqual({ rotation: 90, autoDewarp: true, colorMode: "bw", brightness: 0.1, bwThreshold: 140 });
    expect(presetStepsFromSettings(edited, { rotation: true, crop: true, bw: true })).toEqual({
      autoRotate: true,
      autoDewarp: true,
      autoCrop: true,
      autoBw: true,
    });
  });

  test("describe their steps in the editor's words", () => {
    expect(describePreset({ autoBw: true, autoDewarp: true })).toBe("Automatisch entzerren, Automatisch SW");
    expect(describePreset({ brightness: -0.09, hue: 12, denoise: 1, rotation: 270 })).toBe("Drehung 270°, Helligkeit -9 %, Farbton +12°, Entrauschen: Leicht");
  });

  test("drop unknown values and the values an automatic step replaces", () => {
    expect(normalizePresetSteps({ autoBw: true, brightness: 0.2, bwThreshold: 300, contrast: "x", autoRotate: "ja", rotation: 45 })).toEqual({ autoBw: true });
    expect(normalizePresetSteps({ bwThreshold: 300.4, autoRotate: true, rotation: 90 })).toEqual({ bwThreshold: 255, autoRotate: true });
  });

  test("pick the chosen steps and write fixed values onto settings", () => {
    const steps = { autoBw: true, denoise: 2, hue: 10 };
    expect(pickSteps(steps, ["denoise", "brightness"])).toEqual({ denoise: 2 });
    expect(applyFixedSteps(settings({ brightness: 0.3 }), steps)).toEqual(settings({ brightness: 0.3, denoise: 2, hue: 10 }));
  });
});
