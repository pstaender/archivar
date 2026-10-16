import type { Point, Quad } from "../types";
import { openCv } from "./opencv";
import type { RawImage } from "./raw";

// The page must cover this much of the image; smaller shapes are usually text blocks, tables or photos on the page.
const MIN_AREA = 0.2;
// Above this the page already fills the image and there is nothing to crop.
const MAX_AREA = 0.95;
// Corners closer than this (relative to the image) to an axis-aligned rectangle become a plain crop.
const SNAP_TOLERANCE = 0.015;
const EPSILONS = [0.02, 0.04, 0.06, 0.08, 0.1];

type Mat = InstanceType<ReturnType<typeof openCv>["Mat"]>;

/**
 * Finds the outline of a page or photo in front of a background: edges for pages that stand out by their border,
 * Otsu for a bright page on a darker background (the approach of z80z80z80/autocrop). The largest convex
 * four-cornered shape wins. Returns normalized corners (top-left, top-right, bottom-right, bottom-left) or null.
 */
export function detectDocument(image: RawImage): Quad | null {
  const cv = openCv();
  const { width, height } = image;
  const rgba = new cv.Mat(height, width, cv.CV_8UC4);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const bright = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  try {
    rgba.data.set(image.data);
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

    cv.Canny(gray, edges, 50, 150);
    cv.dilate(edges, edges, kernel);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);

    cv.threshold(gray, bright, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.morphologyEx(bright, bright, cv.MORPH_OPEN, kernel, new cv.Point(-1, -1), 2);

    let best: { quad: Point[]; area: number } | null = null;
    for (const mask of [edges, bright]) {
      const candidate = largestQuad(mask, width * height);
      if (candidate && (!best || candidate.area > best.area)) best = candidate;
    }
    if (!best || best.area > MAX_AREA * width * height) return null;
    return snapToRect(orderCorners(best.quad.map((p) => ({ x: clamp01(p.x / width), y: clamp01(p.y / height) }))));
  } finally {
    rgba.delete();
    gray.delete();
    edges.delete();
    bright.delete();
    kernel.delete();
  }
}

function largestQuad(mask: Mat, imageArea: number): { quad: Point[]; area: number } | null {
  const cv = openCv();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  let best: { quad: Point[]; area: number } | null = null;
  try {
    cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const hull = new cv.Mat();
      try {
        cv.convexHull(contour, hull);
        if (cv.contourArea(hull) < MIN_AREA * imageArea) continue;
        const quad = approximateQuad(hull);
        if (!quad) continue;
        const area = polygonArea(quad);
        if (area >= MIN_AREA * imageArea && (!best || area > best.area)) best = { quad, area };
      } finally {
        contour.delete();
        hull.delete();
      }
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  return best;
}

function approximateQuad(hull: Mat): Point[] | null {
  const cv = openCv();
  const perimeter = cv.arcLength(hull, true);
  for (const epsilon of EPSILONS) {
    const approx = new cv.Mat();
    try {
      cv.approxPolyDP(hull, approx, epsilon * perimeter, true);
      if (approx.rows === 4) {
        const p = approx.data32S;
        return [0, 1, 2, 3].map((i) => ({ x: p[i * 2]!, y: p[i * 2 + 1]! }));
      }
      if (approx.rows < 4) return null;
    } finally {
      approx.delete();
    }
  }
  return null;
}

function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function orderCorners(points: Point[]): Quad {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0]!, byDiff[0]!, bySum[3]!, byDiff[3]!];
}

/** Turns an almost upright outline into an exact rectangle, so it is cropped instead of warped. */
export function snapToRect(quad: Quad): Quad {
  const [tl, tr, br, bl] = quad;
  const upright =
    Math.abs(tl.y - tr.y) < SNAP_TOLERANCE &&
    Math.abs(bl.y - br.y) < SNAP_TOLERANCE &&
    Math.abs(tl.x - bl.x) < SNAP_TOLERANCE &&
    Math.abs(tr.x - br.x) < SNAP_TOLERANCE;
  if (!upright) return quad;
  const left = (tl.x + bl.x) / 2;
  const right = (tr.x + br.x) / 2;
  const top = (tl.y + tr.y) / 2;
  const bottom = (bl.y + br.y) / 2;
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
