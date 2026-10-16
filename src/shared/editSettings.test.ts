import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS, FULL_QUAD, isDefaultEditSettings, normalizeEditSettings, rotateBy } from "./editSettings";

describe("normalizeEditSettings", () => {
  test("returns defaults for invalid input", () => {
    expect(normalizeEditSettings(null)).toEqual(DEFAULT_EDIT_SETTINGS);
    expect(normalizeEditSettings("nope")).toEqual(DEFAULT_EDIT_SETTINGS);
  });

  test("clamps numeric values", () => {
    const s = normalizeEditSettings({ brightness: 5, contrast: -3, hue: 999, denoise: 2.6, bwThreshold: -10 });
    expect(s.brightness).toBe(1);
    expect(s.contrast).toBe(-1);
    expect(s.hue).toBe(180);
    expect(s.denoise).toBe(3);
    expect(s.bwThreshold).toBe(0);
  });

  test("rejects unknown rotation and color mode", () => {
    const s = normalizeEditSettings({ rotation: 45, colorMode: "sepia" });
    expect(s.rotation).toBe(0);
    expect(s.colorMode).toBe("color");
  });

  test("merges partial input onto a base", () => {
    const base = normalizeEditSettings({ brightness: 0.4, colorMode: "grayscale" });
    const s = normalizeEditSettings({ contrast: 0.2 }, base);
    expect(s).toMatchObject({ brightness: 0.4, contrast: 0.2, colorMode: "grayscale" });
  });

  test("normalizes corners and drops the full-image quad", () => {
    expect(normalizeEditSettings({ corners: FULL_QUAD }).corners).toBeNull();
    expect(normalizeEditSettings({ corners: [{ x: 0 }, 1, 2, 3] }).corners).toBeNull();
    const quad = [
      { x: -0.5, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 1.5 },
      { x: 0.1, y: 0.9 },
    ];
    expect(normalizeEditSettings({ corners: quad }).corners).toEqual([
      { x: 0, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 1 },
      { x: 0.1, y: 0.9 },
    ]);
  });

  test("explicit null corners resets a base crop", () => {
    const base = normalizeEditSettings({
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.1 },
        { x: 0.9, y: 0.9 },
        { x: 0.1, y: 0.9 },
      ],
    });
    expect(normalizeEditSettings({ corners: null }, base).corners).toBeNull();
    expect(normalizeEditSettings({}, base).corners).not.toBeNull();
  });
});

test("isDefaultEditSettings", () => {
  expect(isDefaultEditSettings(DEFAULT_EDIT_SETTINGS)).toBe(true);
  expect(isDefaultEditSettings({ ...DEFAULT_EDIT_SETTINGS, hue: 10 })).toBe(false);
});

test("rotateBy wraps around", () => {
  expect(rotateBy(270, 90)).toBe(0);
  expect(rotateBy(0, -90)).toBe(270);
});
