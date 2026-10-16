import { describe, expect, test } from "bun:test";
import { fitScale, formatZoom, lensPosition, zoomIn, zoomOut } from "./zoom";

describe("zoom steps", () => {
  test("zooming in goes to the next step", () => {
    expect(zoomIn(0.34)).toBe(0.5);
    expect(zoomIn(1)).toBe(1.5);
    expect(zoomIn(4)).toBe(4);
  });

  test("zooming out returns to fit once below the fitted size", () => {
    expect(zoomOut(2, 0.34)).toBe(1.5);
    expect(zoomOut(0.5, 0.34)).toBe("fit");
    expect(zoomOut(0.34, 0.34)).toBe("fit");
  });

  test("fit never enlarges small images", () => {
    expect(fitScale({ width: 2000, height: 1000 }, { width: 500, height: 500 })).toBe(0.25);
    expect(fitScale({ width: 200, height: 100 }, { width: 500, height: 500 })).toBe(1);
    expect(fitScale({ width: 0, height: 0 }, { width: 500, height: 500 })).toBe(1);
  });

  test("formats percentages", () => {
    expect(formatZoom(0.333)).toBe("33 %");
  });
});

describe("lensPosition", () => {
  const viewport = { width: 1000, height: 800 };

  test("sits below right of the cursor", () => {
    expect(lensPosition(100, 100, 200, viewport)).toEqual({ left: 124, top: 124 });
  });

  test("flips near the right and bottom edge", () => {
    expect(lensPosition(900, 700, 200, viewport)).toEqual({ left: 676, top: 476 });
  });
});
