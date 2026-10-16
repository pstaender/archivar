import { FULL_QUAD } from "../../shared/editSettings";
import type { Point, Quad } from "../../shared/types";

export type GeometryMode = "none" | "crop" | "perspective";

const MIN_SIZE = 0.05;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function rectQuad(left: number, top: number, right: number, bottom: number): Quad {
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

export function boundingRect(quad: Quad): Quad {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  return rectQuad(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

export function moveCorner(quad: Quad, index: number, to: Point, mode: Exclude<GeometryMode, "none">): Quad {
  const point = { x: clamp01(to.x), y: clamp01(to.y) };
  if (mode === "perspective") {
    const next = quad.map((p) => ({ ...p })) as Quad;
    next[index] = point;
    return next;
  }
  const [tl, , br] = boundingRect(quad);
  let left = tl.x;
  let top = tl.y;
  let right = br.x;
  let bottom = br.y;
  if (index === 0 || index === 3) left = Math.min(point.x, right - MIN_SIZE);
  if (index === 1 || index === 2) right = Math.max(point.x, left + MIN_SIZE);
  if (index === 0 || index === 1) top = Math.min(point.y, bottom - MIN_SIZE);
  if (index === 2 || index === 3) bottom = Math.max(point.y, top + MIN_SIZE);
  return rectQuad(clamp01(left), clamp01(top), clamp01(right), clamp01(bottom));
}

export function translateQuad(quad: Quad, dx: number, dy: number): Quad {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const sx = Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs));
  const sy = Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys));
  return quad.map((p) => ({ x: p.x + sx, y: p.y + sy })) as Quad;
}

// Corners are stored relative to the rotated image, so a rotation must carry them along.
export function rotateQuad(quad: Quad, delta: 90 | -90): Quad {
  const [tl, tr, br, bl] = quad;
  if (delta === 90) {
    const r = (p: Point) => ({ x: 1 - p.y, y: p.x });
    return [r(bl), r(tl), r(tr), r(br)];
  }
  const r = (p: Point) => ({ x: p.y, y: 1 - p.x });
  return [r(tr), r(br), r(bl), r(tl)];
}

export function quadOrFull(quad: Quad | null): Quad {
  return quad ?? (FULL_QUAD.map((p) => ({ ...p })) as Quad);
}
