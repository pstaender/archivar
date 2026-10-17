import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { EditSettings } from "../../shared/types";
import { autoBwState } from "./DocumentPage";

const variants = [
  { brightness: 0.1, contrast: 0.2, bwThreshold: 130 },
  { brightness: 0.1, contrast: 0.2, bwThreshold: 160 },
  { brightness: 0.1, contrast: 0.2, bwThreshold: 100 },
];

const settings = (overrides: Partial<EditSettings>): EditSettings => ({ ...DEFAULT_EDIT_SETTINGS, colorMode: "bw", ...overrides });
const cache = { key: JSON.stringify([0, null, null, 0, false]), variants };

describe("autoBwState", () => {
  test("finds the applied variant and describes it relative to the best guess", () => {
    expect(autoBwState(settings(variants[0]!), cache)).toEqual({ index: 0, count: 3, shade: "best" });
    expect(autoBwState(settings(variants[1]!), cache)).toEqual({ index: 1, count: 3, shade: "darker" });
    expect(autoBwState(settings(variants[2]!), cache)).toEqual({ index: 2, count: 3, shade: "lighter" });
  });

  test("is cleared by manual changes or new geometry", () => {
    expect(autoBwState(settings({ ...variants[0]!, bwThreshold: 131 }), cache)).toBeNull();
    expect(autoBwState(settings({ ...variants[0]!, rotation: 90 }), cache)).toBeNull();
    // The variants were worked out without auto levels.
    expect(autoBwState(settings({ ...variants[0]!, autoLevels: true }), cache)).toBeNull();
    expect(autoBwState(settings({ ...variants[0]!, colorMode: "grayscale" }), cache)).toBeNull();
    expect(autoBwState(settings(variants[0]!), null)).toBeNull();
  });
});
