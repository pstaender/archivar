import { describe, expect, test } from "bun:test";
import { MAX_VECTORIZE_SIZE, normalizeVectorAreas, regionPlan } from "./areas";
import { vtracerBackend } from "./backend";
import { DEFAULT_VECTOR_SETTINGS, normalizeVectorSettings, suggestVectorSettings } from "./settings";
import type { VectorArea } from "./types";

function image(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set([...pixel(x, y), 255], (y * width + x) * 4);
  return { width, height, data };
}

// Black text-like bars on white paper, slightly noisy like a scan.
const scan = image(400, 300, (x, y) => {
  const ink = y % 40 < 12 && x % 60 < 45;
  const v = ink ? 20 + ((x * 7 + y) % 15) : 240 - ((x + y * 3) % 12);
  return [v, v, v];
});
// Colored patches with noise, like a photo.
const noise = (x: number, y: number, c: number) => Math.abs((x * 73856093) ^ (y * 19349663) ^ (c * 83492791)) % 81;
const photo = image(400, 300, (x, y) => {
  const patch = (Math.floor(x / 50) + Math.floor(y / 50) * 8) % 5;
  const base = [[200, 60, 40], [40, 120, 200], [230, 210, 60], [70, 160, 80], [120, 60, 140]][patch]!;
  return base.map((v, c) => Math.max(0, Math.min(255, v + noise(x, y, c) - 40))) as [number, number, number];
});

describe("suggested settings", () => {
  test("black and white for gray images without mid tones, with the threshold between ink and paper", () => {
    const settings = suggestVectorSettings(scan, 1);
    expect(settings.mode).toBe("bw");
    expect(settings.threshold).toBeGreaterThan(40);
    expect(settings.threshold).toBeLessThan(220);
  });

  test("colors and less detail for photo-like areas", () => {
    const settings = suggestVectorSettings(photo, 1);
    expect(settings.mode).toBe("color");
    expect(settings.detail).toBe(DEFAULT_VECTOR_SETTINGS.detail - 1);
  });

  test("more detail for small or low-resolution areas", () => {
    expect(suggestVectorSettings(scan, 1).detail).toBe(3);
    expect(suggestVectorSettings(scan, 0.5).detail).toBe(4);
    expect(suggestVectorSettings(image(80, 60, () => [255, 255, 255]), 1).detail).toBe(4);
  });

  test("are normalized", () => {
    expect(normalizeVectorSettings({ mode: "bw", detail: 9, curves: "sharp", threshold: -3 })).toEqual({ mode: "bw", detail: 5, curves: "sharp", threshold: 1 });
    expect(normalizeVectorSettings(null)).toEqual(DEFAULT_VECTOR_SETTINGS);
  });
});

describe("vtracer backend", () => {
  test("black shapes on white in black and white mode", () => {
    const graphic = vtracerBackend.vectorize(scan, { ...DEFAULT_VECTOR_SETTINGS, mode: "bw", threshold: 128 }, 1);
    expect(graphic.width).toBe(400);
    expect(graphic.background).toBe("#ffffff");
    expect(graphic.paths.length).toBeGreaterThan(10);
    expect(new Set(graphic.paths.map((p) => p.fill))).toEqual(new Set(["#000000"]));
  });

  test("the bottom layer is the background in color mode", () => {
    const graphic = vtracerBackend.vectorize(photo, DEFAULT_VECTOR_SETTINGS, 1);
    expect(graphic.paths[0]!.fill).toBe(graphic.background);
    expect(graphic.paths.length).toBeGreaterThan(5);
  });

  test("more detail keeps more shapes", () => {
    const coarse = vtracerBackend.vectorize(photo, { ...DEFAULT_VECTOR_SETTINGS, detail: 1 }, 1);
    const fine = vtracerBackend.vectorize(photo, { ...DEFAULT_VECTOR_SETTINGS, detail: 5 }, 1);
    expect(fine.paths.length).toBeGreaterThan(coarse.paths.length);
  });
});

describe("areas", () => {
  const area: VectorArea = {
    id: "a",
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    settings: DEFAULT_VECTOR_SETTINGS,
    graphic: { width: 10, height: 10, background: "#FFFFFF", paths: [{ d: "M0 0L10 0L10 10Z", fill: "#000000" }] },
  };

  test("keep valid areas and lower-case colors", () => {
    const [normalized] = normalizeVectorAreas([area]);
    expect(normalized!.graphic!.background).toBe("#ffffff");
    expect(normalized!.x).toBe(0.1);
  });

  test("drop tiny or malformed areas and reject foreign path data", () => {
    expect(normalizeVectorAreas([{ ...area, width: 0.001 }, { x: "1" }, null])).toEqual([]);
    const [script] = normalizeVectorAreas([{ ...area, graphic: { ...area.graphic, paths: [{ d: "M0 0\"/><script>", fill: "#000000" }] } }]);
    expect(script!.graphic).toBeNull();
    expect(normalizeVectorAreas([{ ...area, graphic: { ...area.graphic, width: 0 } }])[0]!.graphic).toBeNull();
  });

  test("get unique ids and are clamped to the image", () => {
    const areas = normalizeVectorAreas([area, { ...area, x: 0.9, width: 0.5 }]);
    expect(areas.map((a) => a.id)).toEqual(["a", "a-1"]);
    expect(areas[1]!.width).toBeCloseTo(0.1);
  });

  test("large regions are scaled down before vectorizing; the scale is relative to A4 at 300 DPI", () => {
    expect(regionPlan({ x: 0, y: 0, width: 0.5, height: 0.5 }, 3508, 2480)).toEqual({
      left: 0,
      top: 0,
      width: 1754,
      height: 1240,
      outWidth: 1754,
      outHeight: 1240,
      pixelScale: 1,
    });
    const big = regionPlan({ x: 0, y: 0, width: 1, height: 1 }, 7016, 4960)!;
    expect(big.outWidth).toBe(MAX_VECTORIZE_SIZE);
    expect(big.pixelScale).toBeCloseTo((2 * MAX_VECTORIZE_SIZE) / 7016);
    expect(regionPlan({ x: 1, y: 1, width: 0, height: 0 }, 100, 100)).toBeNull();
  });
});
