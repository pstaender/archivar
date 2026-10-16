import { describe, expect, test } from "bun:test";
import type { Point, Quad } from "../types";
import { detectDocument, orderCorners, snapToRect } from "./autoCrop";
import type { RawImage } from "./raw";

function inside(quad: Quad, x: number, y: number): boolean {
  return quad.every((a, i) => {
    const b = quad[(i + 1) % 4]!;
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
  });
}

/** A light page with dark text lines on a darker, slightly noisy background. */
function photo(width: number, height: number, page: Quad): RawImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) % 21) - 10;
  const top = Math.min(...page.map((p) => p.y));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const ny = y / height;
      let v = 80 + noise();
      if (inside(page, nx, ny)) {
        const line = Math.floor((ny - top) * 40);
        v = line > 3 && line % 3 === 0 && nx > 0.35 && nx < 0.65 ? 40 : 235 + noise() / 2;
      }
      data.fill(v, (y * width + x) * 4, (y * width + x) * 4 + 3);
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

function expectCorners(actual: Quad | null, expected: Quad, tolerance = 0.02) {
  expect(actual).not.toBeNull();
  actual!.forEach((p, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThan(tolerance);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThan(tolerance);
  });
}

const quad = (...points: [number, number][]) => points.map(([x, y]) => ({ x, y })) as Quad;

describe("detectDocument", () => {
  test("finds a tilted page in perspective", () => {
    const page = quad([0.18, 0.12], [0.84, 0.08], [0.9, 0.9], [0.12, 0.86]);
    expectCorners(detectDocument(photo(600, 800, page)), page);
  });

  test("returns an exact rectangle for an upright page", () => {
    const page = quad([0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]);
    const corners = detectDocument(photo(600, 800, page));
    expectCorners(corners, page);
    expect(corners![0].y).toBe(corners![1].y);
    expect(corners![0].x).toBe(corners![3].x);
  });

  test("finds a page that runs out of the frame", () => {
    const page = quad([0.15, 0.2], [0.85, 0.2], [0.85, 1.2], [0.15, 1.2]);
    expectCorners(detectDocument(photo(600, 800, page)), quad([0.15, 0.2], [0.85, 0.2], [0.85, 1], [0.15, 1]));
  });

  test("returns null without a page or when the page fills the image", () => {
    expect(detectDocument(photo(400, 300, quad([2, 2], [3, 2], [3, 3], [2, 3])))).toBeNull();
    expect(detectDocument(photo(400, 300, quad([0, 0], [1, 0], [1, 1], [0, 1])))).toBeNull();
  });

  test("ignores shapes that are too small to be the page", () => {
    expect(detectDocument(photo(600, 800, quad([0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6])))).toBeNull();
  });
});

describe("corner helpers", () => {
  test("orders corners clockwise from the top left", () => {
    const points: Point[] = [
      { x: 0.9, y: 0.85 },
      { x: 0.1, y: 0.1 },
      { x: 0.15, y: 0.9 },
      { x: 0.85, y: 0.05 },
    ];
    expect(orderCorners(points)).toEqual(quad([0.1, 0.1], [0.85, 0.05], [0.9, 0.85], [0.15, 0.9]));
  });

  test("snaps almost upright outlines to a rectangle and keeps real perspective", () => {
    const snapped = snapToRect(quad([0.1, 0.1], [0.9, 0.105], [0.905, 0.9], [0.1, 0.895]));
    expectCorners(snapped, quad([0.1, 0.1025], [0.9025, 0.1025], [0.9025, 0.8975], [0.1, 0.8975]), 1e-9);
    expect(snapped[0].y).toBe(snapped[1].y);
    expect(snapped[1].x).toBe(snapped[2].x);
    const tilted = quad([0.1, 0.1], [0.9, 0.2], [0.9, 0.9], [0.1, 0.8]);
    expect(snapToRect(tilted)).toEqual(tilted);
  });
});
