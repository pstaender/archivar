/**
 * Least-squares cubic Bézier fitting (Philip J. Schneider, Graphics Gems), ported from flo_curves `bezier/fit.rs`,
 * which visioncortex uses for its splines.
 */
import { add, dot, type Point, scale, sub } from "./geometry";

/** start, control 1, control 2, end */
export type Cubic = [Point, Point, Point, Point];

const MAX_ITERATIONS = 8;
const MAX_POINTS_TO_FIT = 200;

function maxPointsToFit(count: number): number {
  if (count < MAX_POINTS_TO_FIT) return MAX_POINTS_TO_FIT;
  const min = MAX_POINTS_TO_FIT / 4;
  let max = MAX_POINTS_TO_FIT;
  // Avoid a very short last block, which would come out flat.
  while (max > min && count % max < min) max--;
  return max;
}

const distance = (a: Point, b: Point) => Math.sqrt(dot(sub(a, b), sub(a, b)));

function unit(p: Point): Point {
  const magnitude = Math.sqrt(dot(p, p));
  return magnitude === 0 ? { x: 0, y: 0 } : scale(p, 1 / magnitude);
}

const startTangent = (points: Point[]) => unit(sub(points[1]!, points[0]!));
const endTangent = (points: Point[]) => unit(sub(points[points.length - 2]!, points[points.length - 1]!));

function tangentBetween(p1: Point, p2: Point, p3: Point): Point {
  return unit(scale(add(sub(p1, p2), sub(p2, p3)), 0.5));
}

function pointAt([w1, w2, w3, w4]: Cubic, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return { x: w1.x * a + w2.x * b + w3.x * c + w4.x * d, y: w1.y * a + w2.y * b + w3.y * c + w4.y * d };
}

/** Fits cubics to the points, at most `MAX_POINTS_TO_FIT` at a time (`fit_curve`); null for fewer than 2 points. */
export function fitCurve(points: Point[], maxError: number): Cubic[] | null {
  if (points.length < 2) return null;
  const blockSize = maxPointsToFit(points.length);
  const blocks = Math.floor((points.length - 1) / blockSize) + 1;
  const curves: Cubic[] = [];
  for (let block = 0; block < blocks; block++) {
    const start = block * blockSize;
    const count = Math.min(blockSize, points.length - start);
    if (count < 2) continue;
    const blockPoints = points.slice(start, start + count);
    const end = start + count + 1 < points.length ? endTangent(points.slice(start, start + count + 1)) : endTangent(blockPoints);
    curves.push(...fitCubic(blockPoints, startTangent(blockPoints), end, maxError));
  }
  return curves;
}

function fitCubic(points: Point[], start: Point, end: Point, maxError: number): Cubic[] {
  if (points.length <= 2) return [line(points[0]!, points[1]!)];

  let chords = chordsFor(points);
  let curve = generateBezier(points, chords, start, end);
  chords = reparameterize(points, chords, curve);
  curve = generateBezier(points, chords, start, end);
  let [error, split] = maxErrorFor(points, chords, curve);

  if (error > maxError) {
    let lastError = error;
    for (let iteration = 1; iteration < MAX_ITERATIONS; iteration++) {
      chords = reparameterize(points, chords, curve);
      curve = generateBezier(points, chords, start, end);
      [error, split] = maxErrorFor(points, chords, curve);
      if (error / lastError > 0.95 || error <= maxError) break;
      lastError = error;
    }
  }

  // Rust would panic splitting at an end point; that cannot improve the fit anyway.
  if (error <= maxError || split <= 0 || split >= points.length - 1) return [curve];
  const center = tangentBetween(points[split - 1]!, points[split]!, points[split + 1]!);
  return [...fitCubic(points.slice(0, split + 1), start, center, maxError), ...fitCubic(points.slice(split), scale(center, -1), end, maxError)];
}

function line(p1: Point, p2: Point): Cubic {
  const direction = sub(p2, p1);
  return [p1, add(p1, scale(direction, 0.33)), add(p1, scale(direction, 0.66)), p2];
}

function chordsFor(points: Point[]): number[] {
  const distances = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1]!, points[i]!);
    distances.push(total);
  }
  return distances.map((d) => d / total);
}

function generateBezier(points: Point[], chords: number[], start: Point, end: Point): Cubic {
  const a = chords.map((chord) => {
    const inverse = 1 - chord;
    return [scale(start, 3 * chord * inverse * inverse), scale(end, 3 * chord * chord * inverse)] as const;
  });
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  for (let i = 0; i < points.length; i++) {
    const [a0, a1] = a[i]!;
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const chord = chords[i]!;
    const inverse = 1 - chord;
    const b0 = inverse * inverse * inverse;
    const b1 = 3 * chord * inverse * inverse;
    const b2 = 3 * chord * chord * inverse;
    const b3 = chord * chord * chord;
    const tmp = sub(points[i]!, add(add(add(scale(first, b0), scale(first, b1)), scale(last, b2)), scale(last, b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const c10 = c01;
  const detC0C1 = c00 * c11 - c10 * c01;
  const detC0X = c00 * x1 - c10 * x0;
  const detXC1 = x0 * c11 - x1 * c01;
  const alphaL = Math.abs(detC0C1) < 1e-4 ? 0 : detXC1 / detC0C1;
  const alphaR = Math.abs(detC0C1) < 1e-4 ? 0 : detC0X / detC0C1;

  // Wu/Barsky heuristic when an alpha is negative.
  const segmentLength = distance(first, last);
  const epsilon = 1e-6 * segmentLength;
  if (alphaL < epsilon || alphaR < epsilon) {
    const third = segmentLength / 3;
    return [first, add(first, scale(start, third)), add(last, scale(end, third)), last];
  }
  return [first, add(first, scale(start, alphaL)), add(last, scale(end, alphaR)), last];
}

function maxErrorFor(points: Point[], chords: number[], curve: Cubic): [number, number] {
  let biggest = 0;
  let index = 0;
  for (let i = 0; i < points.length; i++) {
    const offset = sub(points[i]!, pointAt(curve, chords[i]!));
    const squared = dot(offset, offset);
    if (squared > biggest) {
      biggest = squared;
      index = i;
    }
  }
  return [Math.sqrt(biggest), index];
}

function reparameterize(points: Point[], chords: number[], curve: Cubic): number[] {
  return points.map((p, i) => newtonRaphson(curve, p, chords[i]!));
}

function newtonRaphson(curve: Cubic, p: Point, t: number): number {
  const [start, cp1, cp2, end] = curve;
  const qt = pointAt(curve, t);
  const qn1 = scale(sub(cp1, start), 3);
  const qn2 = scale(sub(cp2, cp1), 3);
  const qn3 = scale(sub(end, cp2), 3);
  const qnn1 = scale(sub(qn2, qn1), 2);
  const qnn2 = scale(sub(qn3, qn2), 2);
  const lerp = (a: Point, b: Point) => add(scale(a, 1 - t), scale(b, t));
  const qnt = lerp(lerp(qn1, qn2), lerp(qn2, qn3));
  const qnnt = lerp(qnn1, qnn2);
  const numerator = dot(sub(qt, p), qnt);
  const denominator = dot(qnt, qnt) + dot(sub(qt, p), qnnt);
  if (denominator === 0) return t;
  return Math.min(1, Math.max(0, t - numerator / denominator));
}
