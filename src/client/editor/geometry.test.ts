import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { EditSettings, Quad } from "../../shared/types";
import { boundingRect, moveCorner, quadOrFull, rectQuad, rotateQuad, rotateSettings, translateQuad, withRotation } from "./geometry";

const rect = rectQuad(0.2, 0.2, 0.8, 0.8);

describe("moveCorner", () => {
  test("perspective mode moves a single corner", () => {
    const out = moveCorner(rect, 2, { x: 0.9, y: 0.95 }, "perspective");
    expect(out[2]).toEqual({ x: 0.9, y: 0.95 });
    expect(out[1]).toEqual(rect[1]);
  });

  test("crop mode keeps the quad rectangular", () => {
    const out = moveCorner(rect, 0, { x: 0.1, y: 0.3 }, "crop");
    expect(out).toEqual(rectQuad(0.1, 0.3, 0.8, 0.8));
  });

  test("crop mode enforces a minimum size", () => {
    const out = moveCorner(rect, 2, { x: 0, y: 0 }, "crop");
    expect(out[2].x).toBeCloseTo(0.25);
    expect(out[2].y).toBeCloseTo(0.25);
  });

  test("clamps to the image", () => {
    expect(moveCorner(rect, 1, { x: 3, y: -1 }, "perspective")[1]).toEqual({ x: 1, y: 0 });
  });
});

test("boundingRect", () => {
  const quad: Quad = [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.1 },
    { x: 0.8, y: 0.9 },
    { x: 0.2, y: 0.7 },
  ];
  expect(boundingRect(quad)).toEqual(rectQuad(0.1, 0.1, 0.9, 0.9));
});

test("translateQuad stays inside the image", () => {
  const moved = translateQuad(rect, 0.5, -0.5);
  expect(moved[0].x).toBeCloseTo(0.4);
  expect(moved[0].y).toBeCloseTo(0);
  expect(moved[2].x).toBeCloseTo(1);
  expect(moved[2].y).toBeCloseTo(0.6);
});

describe("rotateQuad", () => {
  test("rotating clockwise maps the crop onto the rotated image", () => {
    const top = rectQuad(0, 0, 1, 0.5);
    expect(rotateQuad(top, 90)).toEqual(rectQuad(0.5, 0, 1, 1));
  });

  test("rotating back and forth is the identity", () => {
    const quad: Quad = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.7 },
    ];
    const back = rotateQuad(rotateQuad(quad, 90), -90);
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(quad[i]!.x);
      expect(p.y).toBeCloseTo(quad[i]!.y);
    });
  });
});

test("quadOrFull", () => {
  expect(quadOrFull(null)).toEqual(rectQuad(0, 0, 1, 1));
  expect(quadOrFull(rect)).toBe(rect);
});

describe("rotation of edit settings", () => {
  const dewarp = { rotation: 0 as const, columns: 31, rows: 45, points: [] };

  test("carries corners along and drops a dewarp grid", () => {
    const settings: EditSettings = { ...DEFAULT_EDIT_SETTINGS, corners: rectQuad(0, 0, 1, 0.5) };
    expect(rotateSettings(settings, 90)).toMatchObject({ rotation: 90, corners: rectQuad(0.5, 0, 1, 1), dewarp: null });
    expect(rotateSettings({ ...settings, dewarp }, -90)).toMatchObject({ rotation: 270, corners: null, dewarp: null });
  });

  test("turns to an absolute rotation", () => {
    const settings: EditSettings = { ...DEFAULT_EDIT_SETTINGS, rotation: 90, corners: rectQuad(0, 0, 1, 0.5) };
    expect(withRotation(settings, 270)).toMatchObject({ rotation: 270, corners: rectQuad(0, 0.5, 1, 1) });
    expect(withRotation(settings, 0)).toMatchObject({ rotation: 0, corners: rectQuad(0, 0, 0.5, 1) });
    expect(withRotation({ ...settings, dewarp }, 90)).toEqual({ ...settings, dewarp });
  });
});
