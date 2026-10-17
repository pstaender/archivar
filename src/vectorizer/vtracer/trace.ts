/** Region outlines as polygons or splines (visioncortex `clusters.rs`, vtracer `fitter.rs`). */
import type { BinaryImage } from "./binaryImage";
import type { Point } from "./geometry";
import { imageToPolygon } from "./path";
import { smoothPath, splineFromPath } from "./spline";

export type FitMode = "polygon" | "spline";

export interface FitParams {
  /** Radians */
  cornerThreshold: number;
  /** Segments are subdivided until they are shorter than this (px). */
  lengthThreshold: number;
  maxIterations: number;
  /** Radians */
  spliceThreshold: number;
}

/** One closed contour in canvas coordinates: a polygon (last point repeats the first) or a spline of 1 + 3n points. */
export type Contour = { kind: "polygon"; points: Point[] } | { kind: "spline"; points: Point[] };

function offsetPoints(points: Point[], dx: number, dy: number): Point[] {
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

/**
 * The outer boundary (traced clockwise) and every enclosed hole (counter-clockwise, so the non-zero fill rule leaves
 * it empty). Holes touching the image border are open to the outside and part of the outer boundary.
 */
function boundaries(image: BinaryImage): { image: BinaryImage; dx: number; dy: number }[] {
  const outer = image.clone();
  const result = [{ image: outer, dx: 0, dy: 0 }];
  for (const hole of image.negative().toClusters(false)) {
    const { rect } = hole;
    if (rect.left === 0 || rect.top === 0 || rect.right === image.width || rect.bottom === image.height) continue;
    for (let k = 0; k < hole.size; k++) outer.set(hole.xs[k]!, hole.ys[k]!, true);
    result.push({ image: hole.toBinaryImage(), dx: rect.left, dy: rect.top });
  }
  return result;
}

/** `Cluster::image_to_compound_path` for one connected shape at (dx, dy). */
function traceShape(image: BinaryImage, dx: number, dy: number, mode: FitMode, params: FitParams): Contour[] {
  const contours: Contour[] = [];
  boundaries(image).forEach((boundary, i) => {
    const clockwise = i === 0;
    const polygon = imageToPolygon(boundary.image, clockwise);
    if (mode === "polygon") {
      if (polygon.length > 0) contours.push({ kind: "polygon", points: offsetPoints(polygon, dx + boundary.dx, dy + boundary.dy) });
      return;
    }
    if (polygon.length < 2) return;
    const smoothed = smoothPath(polygon, params.cornerThreshold, params.lengthThreshold, params.maxIterations);
    const spline = splineFromPath(smoothed, params.spliceThreshold);
    if (spline.length > 3) contours.push({ kind: "spline", points: offsetPoints(spline, dx + boundary.dx, dy + boundary.dy) });
  });
  return contours;
}

/** Traces every 4-connected part of a region mask positioned at (left, top) on the canvas. */
export function traceRegion(mask: BinaryImage, left: number, top: number, mode: FitMode, params: FitParams): Contour[] {
  const contours: Contour[] = [];
  for (const part of mask.toClusters(false)) {
    contours.push(...traceShape(part.toBinaryImage(), left + part.rect.left, top + part.rect.top, mode, params));
  }
  return contours;
}
