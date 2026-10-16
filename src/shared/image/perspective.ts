import type { Point, Quad } from "../types";
import type { RawImage } from "./raw";

type Matrix3 = [number, number, number, number, number, number, number, number, number];

function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new Error("Degenerate quad");
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row]![col]! / m[col]![col]!;
      for (let k = col; k <= n; k++) m[row]![k]! -= factor * m[col]![k]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

export function computeHomography(from: Quad, to: Quad): Matrix3 {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]!;
    const { x: u, y: v } = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinearSystem(a, b);
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

export function applyHomography(h: Matrix3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function quadToPixels(quad: Quad, width: number, height: number): Quad {
  return quad.map((p) => ({ x: p.x * width, y: p.y * height })) as Quad;
}

export function outputSizeForQuad(quad: Quad): { width: number; height: number } {
  const [tl, tr, br, bl] = quad;
  return {
    width: Math.max(1, Math.round(Math.max(distance(tl, tr), distance(bl, br)))),
    height: Math.max(1, Math.round(Math.max(distance(tl, bl), distance(tr, br)))),
  };
}

export function isAxisAlignedRect(quad: Quad): boolean {
  const [tl, tr, br, bl] = quad;
  const eps = 1e-6;
  return (
    Math.abs(tl.y - tr.y) < eps &&
    Math.abs(bl.y - br.y) < eps &&
    Math.abs(tl.x - bl.x) < eps &&
    Math.abs(tr.x - br.x) < eps
  );
}

export function warpPerspective(src: RawImage, normalizedQuad: Quad): RawImage {
  const quad = quadToPixels(normalizedQuad, src.width, src.height);
  const { width, height } = outputSizeForQuad(quad);
  const target: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  const h = computeHomography(target, quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const data = src.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w = h[6] * px + h[7] * py + h[8];
      const sx = Math.min(sw - 1, Math.max(0, (h[0] * px + h[1] * py + h[2]) / w - 0.5));
      const sy = Math.min(sh - 1, Math.max(0, (h[3] * px + h[4] * py + h[5]) / w - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c]! * (1 - fx) + data[i10 + c]! * fx;
        const bottom = data[i01 + c]! * (1 - fx) + data[i11 + c]! * fx;
        out[o + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { width, height, data: out };
}
