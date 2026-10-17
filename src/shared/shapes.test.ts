import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "./editSettings";
import { drawShapes, MAX_SHAPES, normalizeShapes, shapeGeometry } from "./shapes";

const rect = { id: "a", type: "rect" as const, x: 0.25, y: 0.25, width: 0.5, height: 0.5, color: "#FF0000" };

describe("shapes", () => {
  test("keep valid rectangles inside the image and drop the rest", () => {
    expect(normalizeShapes([rect])).toEqual([{ ...rect, color: "#ff0000" }]);
    expect(normalizeShapes([{ ...rect, x: 0.8, width: 0.5 }])[0]).toMatchObject({ x: 0.8, width: expect.closeTo(0.2) });
    expect(normalizeShapes([{ ...rect, x: -1 }])[0]).toMatchObject({ x: 0 });
    expect(normalizeShapes([{ ...rect, color: "red" }, { ...rect, type: "circle" }, { ...rect, width: 0.001 }, { ...rect, y: "1" }, null])).toEqual([]);
    expect(normalizeShapes("x")).toEqual([]);
  });

  test("give every shape a unique id and limit their number", () => {
    const shapes = normalizeShapes([rect, rect, { ...rect, id: "" }]);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(3);
    expect(normalizeShapes(Array.from({ length: MAX_SHAPES + 5 }, (_, i) => ({ ...rect, id: String(i) })))).toHaveLength(MAX_SHAPES);
  });

  test("paint rectangles opaquely", () => {
    const data = new Uint8Array(4 * 4 * 4).fill(10);
    drawShapes({ data, width: 4, height: 4 }, normalizeShapes([rect]));
    const pixel = (x: number, y: number) => Array.from(data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(pixel(1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(0, 0)).toEqual([10, 10, 10, 10]);
    expect(pixel(3, 2)).toEqual([10, 10, 10, 10]);
  });

  test("tell geometry changes from other edits", () => {
    const base = shapeGeometry(DEFAULT_EDIT_SETTINGS);
    expect(shapeGeometry({ ...DEFAULT_EDIT_SETTINGS, brightness: 0.5, colorMode: "bw" })).toBe(base);
    expect(shapeGeometry({ ...DEFAULT_EDIT_SETTINGS, rotation: 90 })).not.toBe(base);
  });
});
