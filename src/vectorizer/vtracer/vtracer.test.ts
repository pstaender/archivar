import { describe, expect, test } from "bun:test";
import { BinaryImage } from "./binaryImage";
import { fitCurve } from "./bezierFit";
import { clusterColors } from "./colorClusters";
import { formatNumber, pathData, toSvg, vtrace } from "./index";
import { imageToPolygon, limitPenalties, walkOutline } from "./path";

function binary(rows: string[]): BinaryImage {
  const image = new BinaryImage(rows[0]!.length, rows.length);
  rows.forEach((row, y) => [...row].forEach((c, x) => image.set(x, y, c === "*")));
  return image;
}

/** White canvas with filled rectangles. */
function canvas(width: number, height: number, rects: { x: number; y: number; w: number; h: number; color: [number, number, number] }[]) {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (const { x, y, w, h, color } of rects) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) data.set([...color, 255], (yy * width + xx) * 4);
    }
  }
  return { width, height, data };
}

/** Signed area of a closed polygon; > 0 is clockwise with y pointing down. */
function orientation(points: { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0; i + 1 < points.length; i++) sum += points[i]!.x * points[i + 1]!.y - points[i + 1]!.x * points[i]!.y;
  return sum;
}

describe("binary clusters", () => {
  test("finds 4-connected components, or 8-connected with diagonal", () => {
    const image = binary(["*--", "-*-", "--*"]);
    expect(image.toClusters(false).map((c) => c.size)).toEqual([1, 1, 1]);
    expect(image.toClusters(true).map((c) => c.size)).toEqual([3]);
  });

  test("merges branches that join further down", () => {
    const [cluster, ...rest] = binary(["*-*", "*-*", "***"]).toClusters(false);
    expect(rest).toEqual([]);
    expect(cluster!.size).toBe(7);
    expect([cluster!.rect.left, cluster!.rect.top, cluster!.rect.width, cluster!.rect.height]).toEqual([0, 0, 3, 3]);
  });
});

describe("outline", () => {
  test("walks the corners of a rectangle clockwise and closes the path", () => {
    const path = walkOutline(binary(["---", "-**", "-**"]), true);
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
      { x: 1, y: 1 },
    ]);
    expect(orientation(path)).toBeGreaterThan(0);
    expect(orientation(walkOutline(binary(["**", "**"]), false))).toBeLessThan(0);
  });

  test("simplifies a 1 px staircase into a diagonal", () => {
    const polygon = imageToPolygon(binary(["*---", "**--", "***-", "****"]), true);
    expect(polygon.length).toBeLessThan(walkOutline(binary(["*---", "**--", "***-", "****"]), true).length);
    expect(polygon[0]).toEqual(polygon.at(-1)!);
  });

  test("ignores the degenerate triangle of the closing point like Rust's f64::max", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    expect(limitPenalties(square)).toEqual(square);
  });
});

describe("Bézier fitting", () => {
  test("reproduces points sampled from a cubic within the error", () => {
    const curve = (t: number) => ({ x: 300 * t, y: 100 * Math.sin(Math.PI * t) });
    const points = Array.from({ length: 50 }, (_, i) => curve(i / 49));
    const fitted = fitCurve(points, 1)!;
    expect(fitted.length).toBeGreaterThanOrEqual(1);
    expect(fitted[0]![0]).toEqual(points[0]!);
    expect(fitted.at(-1)![3]).toEqual(points.at(-1)!);
  });

  test("splits a sharp corner into several curves", () => {
    const points = [...Array.from({ length: 21 }, (_, i) => ({ x: i * 15, y: i * 15 })), ...Array.from({ length: 20 }, (_, i) => ({ x: 300 + (i + 1) * 15, y: 300 - (i + 1) * 15 }))];
    expect(fitCurve(points, 2)!.length).toBeGreaterThanOrEqual(2);
  });

  test("needs at least two points", () => {
    expect(fitCurve([{ x: 1, y: 1 }], 1)).toBeNull();
  });
});

describe("color clustering", () => {
  test("layers go from the background to the details on top", () => {
    const image = canvas(40, 30, [
      { x: 5, y: 5, w: 30, h: 20, color: [200, 30, 30] },
      { x: 15, y: 10, w: 10, h: 10, color: [20, 20, 200] },
    ]);
    const layers = clusterColors(image, {
      diagonal: false,
      goodMinArea: 16,
      goodMaxArea: 1200,
      isSameColorA: 2,
      isSameColorB: 1,
      deepenDiff: 16,
      hollowNeighbours: 1,
    });
    expect(layers).toHaveLength(3);
    expect([layers[0]!.left, layers[0]!.top, layers[0]!.mask.width, layers[0]!.mask.height]).toEqual([0, 0, 40, 30]);
    const top = layers[2]!;
    expect([top.left, top.top, top.mask.width, top.mask.height]).toEqual([15, 10, 10, 10]);
    expect(top.color).toEqual({ r: 20, g: 20, b: 200 });
    expect(new Set(layers.map((l) => JSON.stringify(l.color))).size).toBe(3);
  });

  test("small speckles are absorbed into their neighbour", () => {
    const image = canvas(30, 30, [{ x: 10, y: 10, w: 2, h: 2, color: [0, 0, 0] }]);
    const doc = vtrace(image, { filterSpeckle: 4 });
    expect(doc.shapes).toHaveLength(1);
  });
});

describe("vtrace", () => {
  const ring = canvas(40, 30, [
    { x: 5, y: 5, w: 30, h: 20, color: [0, 0, 0] },
    { x: 15, y: 10, w: 10, h: 10, color: [255, 255, 255] },
  ]);

  test("binary mode traces black shapes with holes in the opposite direction", () => {
    const doc = vtrace(ring, { clustering: "binary", mode: "polygon" });
    expect(doc.shapes).toHaveLength(1);
    const [outer, hole] = doc.shapes[0]!.contours;
    expect(outer!.points.slice(0, -1)).toEqual([
      { x: 5, y: 5 },
      { x: 35, y: 5 },
      { x: 35, y: 25 },
      { x: 5, y: 25 },
    ]);
    expect(orientation(outer!.points)).toBeGreaterThan(0);
    expect(orientation(hole!.points)).toBeLessThan(0);
    expect(pathData(doc.shapes[0]!.contours)).toBe("M5 5L35 5L35 25L5 25ZM15 10L15 20L25 20L25 10Z");
  });

  test("spline mode closes every contour with cubic segments", () => {
    const doc = vtrace(ring, { clustering: "binary" });
    const d = pathData(doc.shapes[0]!.contours);
    expect(d).toMatch(/^M5 5C/);
    expect(d.match(/Z/g)).toHaveLength(2);
    for (const contour of doc.shapes[0]!.contours) expect((contour.points.length - 1) % 3).toBe(0);
  });

  test("drops speckles below the speckle size in binary mode", () => {
    const image = canvas(30, 30, [
      { x: 2, y: 2, w: 2, h: 2, color: [0, 0, 0] },
      { x: 10, y: 10, w: 10, h: 10, color: [0, 0, 0] },
    ]);
    expect(vtrace(image, { clustering: "binary", filterSpeckle: 3 }).shapes).toHaveLength(1);
    expect(vtrace(image, { clustering: "binary", filterSpeckle: 1 }).shapes).toHaveLength(2);
  });

  test("writes an SVG document", () => {
    const svg = toSvg(vtrace(ring, { clustering: "binary", mode: "polygon" }));
    expect(svg).toContain('width="40" height="30"');
    expect(svg).toContain('<path d="M5 5L35 5L35 25L5 25ZM15 10L15 20L25 20L25 10Z" fill="#000000"/>');
  });

  test("formats numbers like VTracer", () => {
    expect(formatNumber(1.5, 2)).toBe("1.5");
    expect(formatNumber(2, 2)).toBe("2");
    expect(formatNumber(100.004, 2)).toBe("100");
    expect(formatNumber(-0.126, 2)).toBe("-0.13");
  });

  test("rejects empty images", () => {
    expect(() => vtrace({ width: 0, height: 0, data: new Uint8Array() })).toThrow();
  });
});
