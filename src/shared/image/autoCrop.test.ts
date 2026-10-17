import { describe, expect, test } from "bun:test";
import type { Point, Quad } from "../types";
import { orderCorners, quadFromMask, snapToRect } from "./autoCrop";

function inside(quad: Quad, x: number, y: number): boolean {
  return quad.every((a, i) => {
    const b = quad[(i + 1) % 4]!;
    return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
  });
}

function expectCorners(actual: Quad | null, expected: Quad, tolerance = 0.02) {
  expect(actual).not.toBeNull();
  actual!.forEach((p, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThan(tolerance);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThan(tolerance);
  });
}

const quad = (...points: [number, number][]) => points.map(([x, y]) => ({ x, y })) as Quad;

function mask(size: number, page: Quad): Uint8Array {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (inside(page, (x + 0.5) / size, (y + 0.5) / size)) data[y * size + x] = 255;
  }
  return data;
}

describe("quadFromMask", () => {
  test("finds the corners of the segmented page", () => {
    const page = quad([0.18, 0.12], [0.84, 0.08], [0.9, 0.9], [0.12, 0.86]);
    expectCorners(quadFromMask(mask(384, page), 384, 384), page);
  });

  test("keeps the largest region and ignores specks", () => {
    const data = mask(384, quad([0.3, 0.3], [0.7, 0.3], [0.7, 0.75], [0.3, 0.75]));
    data.fill(255, 10 * 384 + 10, 10 * 384 + 20);
    expectCorners(quadFromMask(data, 384, 384), quad([0.3, 0.3], [0.7, 0.3], [0.7, 0.75], [0.3, 0.75]));
  });

  test("finds a page that runs out of the frame", () => {
    const page = quad([0.15, 0.2], [0.85, 0.2], [0.85, 1.2], [0.15, 1.2]);
    expectCorners(quadFromMask(mask(384, page), 384, 384), quad([0.15, 0.2], [0.85, 0.2], [0.85, 1], [0.15, 1]));
  });

  test("returns an exact rectangle for an upright page", () => {
    const corners = quadFromMask(mask(384, quad([0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9])), 384, 384);
    expect(corners![0].y).toBe(corners![1].y);
    expect(corners![0].x).toBe(corners![3].x);
  });

  test("returns null without a page or when the page fills the image", () => {
    expect(quadFromMask(new Uint8Array(384 * 384), 384, 384)).toBeNull();
    expect(quadFromMask(mask(384, quad([0.45, 0.45], [0.55, 0.45], [0.55, 0.55], [0.45, 0.55])), 384, 384)).toBeNull();
    expect(quadFromMask(new Uint8Array(384 * 384).fill(255), 384, 384)).toBeNull();
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
