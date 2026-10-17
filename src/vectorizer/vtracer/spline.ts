/** Smoothing and spline fitting of closed outlines (visioncortex `path/smooth.rs`, `path/spline.rs`). */
import { type Cubic, fitCurve } from "./bezierFit";
import { add, angle, findIntersection, isSignNegative, midPoint, norm, normalize, type Point, scale, signedAngleDifference, sub } from "./geometry";

/** The spline fit's error bound in pixels, fixed in visioncortex. */
const MAX_FIT_ERROR = 10;
const OUTSET_RATIO = 8;

/** Without the closing point: true where the outline turns by at least `threshold` radians. */
export function findCorners(path: Point[], threshold: number): boolean[] {
  const points = path.slice(0, -1);
  const len = points.length;
  const corners = new Array<boolean>(len).fill(false);
  for (let i = 0; i < len; i++) {
    const prev = i === 0 ? len - 1 : i - 1;
    const next = (i + 1) % len;
    const a1 = angle(normalize(sub(points[i]!, points[prev]!)));
    const a2 = angle(normalize(sub(points[next]!, points[i]!)));
    if (Math.abs(signedAngleDifference(a1, a2)) >= threshold) corners[i] = true;
  }
  return corners;
}

/** Without the closing point: inflection points and points where the accumulated turn reaches `threshold`. */
export function findSplicePoints(path: Point[], threshold: number): boolean[] {
  const points = path.slice(0, -1);
  const len = points.length;
  const splice = new Array<boolean>(len).fill(false);
  let increasing = false;
  let started = false;
  let displacement = 0;
  for (let i = 0; i < len; i++) {
    const prev = i === 0 ? len - 1 : i - 1;
    const next = (i + 1) % len;
    const a1 = angle(normalize(sub(points[i]!, points[prev]!)));
    const a2 = angle(normalize(sub(points[next]!, points[i]!)));
    const diff = signedAngleDifference(a1, a2);
    const currentlyIncreasing = !isSignNegative(diff);
    if (!started) {
      increasing = currentlyIncreasing;
      started = true;
    } else if (increasing !== currentlyIncreasing) {
      splice[i] = true;
      increasing = currentlyIncreasing;
    }
    displacement += diff;
    if (Math.abs(displacement) >= threshold) splice[i] = true;
    if (splice[i]) displacement = 0;
  }
  return splice;
}

function fourPointScheme(pi: Point, pj: Point, p1: Point, p2: Point, outsetRatio: number): Point {
  const out = midPoint(pi, pj);
  const vector = sub(out, midPoint(p1, p2));
  const magnitude = norm(vector) / outsetRatio;
  if (magnitude < Number.EPSILON) return out;
  return add(out, scale(normalize(vector), magnitude));
}

/** One subdivision round of the 4-point scheme that keeps corners; `done` when no segment is still too long. */
function subdivideKeepCorners(path: Point[], corners: boolean[], outsetRatio: number, segmentLength: number) {
  const points = path.slice(0, -1);
  const len = points.length;
  let done = true;
  const next: Point[] = [];
  const nextCorners: boolean[] = [];
  for (let i = 0; i < len; i++) {
    next.push(points[i]!);
    nextCorners.push(corners[i]!);
    const j = (i + 1) % len;
    const current = norm(sub(points[i]!, points[j]!));
    if (current <= segmentLength) continue;
    let before = i === 0 ? len - 1 : i - 1;
    let after = (j + 1) % len;
    const lengthBefore = norm(sub(points[before]!, points[i]!));
    const lengthAfter = norm(sub(points[after]!, points[j]!));
    if (lengthBefore / current >= 2 || lengthAfter / current >= 2) continue;
    // 3-point scheme at corners, so they stay sharp.
    if (corners[i]) before = i;
    if (corners[j]) after = j;
    if (before === i && after === j) continue;
    const point = fourPointScheme(points[i]!, points[j]!, points[before]!, points[after]!, outsetRatio);
    next.push(point);
    nextCorners.push(false);
    if (norm(sub(points[i]!, point)) > segmentLength || norm(sub(points[j]!, point)) > segmentLength) done = false;
  }
  next.push(next[0]!);
  return { path: next, corners: nextCorners, done };
}

/** Subdivides the closed polygon into a smooth outline while keeping its corners (`PathI32::smooth`). */
export function smoothPath(path: Point[], cornerThreshold: number, segmentLength: number, maxIterations: number): Point[] {
  let corners = findCorners(path, cornerThreshold);
  let smoothed = path;
  for (let i = 0; i < maxIterations; i++) {
    const result = subdivideKeepCorners(smoothed, corners, OUTSET_RATIO, segmentLength);
    smoothed = result.path;
    corners = result.corners;
    if (result.done) break;
  }
  return smoothed;
}

function retractHandles(a: Point, b: Point, c: Point, d: Point): Cubic {
  const ab = sub(b, a);
  const dab = signedAngleDifference(angle(normalize(sub(a, d))), angle(normalize(ab)));
  const abc = signedAngleDifference(angle(normalize(ab)), angle(normalize(sub(c, b))));
  // The handles cross each other.
  if (isSignNegative(dab) !== isSignNegative(abc)) {
    const intersection = findIntersection(a, b, c, d);
    if (intersection) return [a, intersection, intersection, d];
  }
  return [a, b, c, d];
}

/** Adds points along long segments, since the fit only measures its error at the points. */
function densify(points: Point[], spacing: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    out.push(a);
    const n = Math.ceil(norm(sub(b, a)) / spacing);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** The chain of cubics through the points, with both end points kept exactly (`fit_points_with_beziers`). */
export function fitPointsWithBeziers(points: Point[], maxError: number): Cubic[] {
  const p1 = points[0]!;
  const p4 = points[points.length - 1]!;
  const curves = fitCurve(densify(points, maxError), maxError);
  if (!curves || curves.length === 0) return [[p1, p1, p4, p4]];
  const raw = curves.map((c): Cubic => [...c]);
  raw[0]![0] = p1;
  raw[raw.length - 1]![3] = p4;
  for (let i = 1; i < raw.length; i++) {
    const shared = midPoint(raw[i - 1]![3], raw[i]![0]);
    raw[i - 1]![3] = shared;
    raw[i]![0] = shared;
  }
  return raw.map((c) => retractHandles(c[0], c[1], c[2], c[3]));
}

function circularSubpath(path: Point[], from: number, to: number): Point[] {
  if (from < to) return path.slice(from, to + 1);
  if (from > to) return [...path.slice(from), ...path.slice(0, to + 1)];
  return [];
}

/** A spline of 1 + 3n points (the start, then two controls and an end per curve) for the smoothed outline. */
export function splineFromPath(path: Point[], spliceThreshold: number): Point[] {
  const splicePoints = findSplicePoints(path, spliceThreshold);
  const points = path.slice(0, -1);
  const len = points.length;
  if (len <= 1) return [{ x: 0, y: 0 }];
  if (len === 2) return [points[0]!, points[1]!, points[1]!, points[1]!];
  const cuts = splicePoints.flatMap((cut, i) => (cut ? [i] : []));
  if (cuts.length === 0) cuts.push(0);
  if (cuts.length === 1) cuts.push((cuts[0]! + Math.floor(len / 2)) % len);
  const spline: Point[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const subpath = circularSubpath(points, cuts[i]!, cuts[(i + 1) % cuts.length]!);
    for (const [start, c1, c2, end] of fitPointsWithBeziers(subpath, MAX_FIT_ERROR)) {
      if (spline.length === 0) spline.push(start);
      spline.push(c1, c2, end);
    }
  }
  return spline.length > 0 ? spline : [{ x: 0, y: 0 }];
}
