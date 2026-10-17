import type { Point, Quad } from "../types";
import { openCv } from "./opencv";
import type { RawImage } from "./raw";

// Above this the page already fills the image and there is nothing to crop.
const MAX_AREA = 0.95;
// Corners closer than this (relative to the image) to an axis-aligned rectangle become a plain crop.
const SNAP_TOLERANCE = 0.015;
const EPSILONS = [0.02, 0.04, 0.06, 0.08, 0.1];
// A segmentation model also finds small pages, e.g. a receipt on a table.
const MIN_MASK_AREA = 0.05;

/**
 * Corners of the page in a segmentation mask (non-zero = page), the post-processing of LearnOpenCV's DeepLabV3
 * document scanner: the largest region's outline approximated to four corners, or its minimum-area rectangle when
 * it has no clear four corners (e.g. a corner outside the image). Returns normalized corners or null.
 */
export function quadFromMask(mask: Uint8Array, width: number, height: number): Quad | null {
  const cv = openCv();
  const image = new cv.Mat(height, width, cv.CV_8UC1);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const hull = new cv.Mat();
  try {
    image.data.set(mask);
    cv.findContours(image, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    let page = -1;
    let pageArea = MIN_MASK_AREA * width * height;
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      contour.delete();
      if (area >= pageArea) [page, pageArea] = [i, area];
    }
    if (page < 0) return null;
    const contour = contours.get(page);
    try {
      cv.convexHull(contour, hull);
      const quad = approximateQuad(hull) ?? cv.boxPoints(cv.minAreaRect(contour));
      if (polygonArea(quad) > MAX_AREA * width * height) return null;
      return snapToRect(orderCorners(quad.map((p) => ({ x: clamp01(p.x / width), y: clamp01(p.y / height) }))));
    } finally {
      contour.delete();
    }
  } finally {
    image.delete();
    contours.delete();
    hierarchy.delete();
    hull.delete();
  }
}

function approximateQuad(hull: InstanceType<ReturnType<typeof openCv>["Mat"]>): Point[] | null {
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
