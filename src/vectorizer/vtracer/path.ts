import type { BinaryImage } from "./binaryImage";
import { maxIgnoringNaN, type Point, signedArea } from "./geometry";

const DIRECTIONS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

// The two pixels on either side of the lattice edge leaving a corner point in direction 0, 2, 4 or 6.
const SIDES: Record<number, [Point, Point]> = {
  0: [{ x: -1, y: -1 }, { x: 0, y: -1 }],
  2: [{ x: 0, y: 0 }, { x: 0, y: -1 }],
  4: [{ x: -1, y: 0 }, { x: 0, y: 0 }],
  6: [{ x: -1, y: 0 }, { x: -1, y: -1 }],
};

const CLOCKWISE = [0, 2, 4, 6];
const COUNTER_CLOCKWISE = [6, 4, 2, 0];
const MAX_WALK = 1_000_000;

const ahead = (p: Point, dir: number): Point => ({ x: p.x + DIRECTIONS[dir]!.x, y: p.y + DIRECTIONS[dir]!.y });
const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;

/**
 * Walks the outline of the shape on the pixel lattice from its top left pixel and returns the corner points; the last
 * point repeats the first (`PathWalker`).
 */
export function walkOutline(image: BinaryImage, clockwise: boolean): Point[] {
  const start = image.firstPixel();
  if (!start) return [];
  const path: Point[] = [start];
  const order = clockwise ? CLOCKWISE : COUNTER_CLOCKWISE;
  let curr = start;
  let prev = start;
  let prevPrev = start;
  let length = 0;
  while (!(equal(curr, start) && length > 0)) {
    let dir = -1;
    for (;;) {
      let go = -1;
      for (const k of order) {
        const next = ahead(curr, k);
        if (equal(next, prev) || equal(next, prevPrev)) continue;
        const [a, b] = SIDES[k]!;
        if (image.getSafe(curr.x + a.x, curr.y + a.y) !== image.getSafe(curr.x + b.x, curr.y + b.y)) {
          go = k;
          break;
        }
      }
      // visioncortex panics here; the shape is then dropped instead.
      if (go === -1) return [];
      if (dir !== -1 && dir !== go) break;
      dir = go;
      prevPrev = prev;
      prev = curr;
      curr = ahead(curr, go);
      length++;
    }
    if (length > MAX_WALK) return [];
    path.push(curr);
  }
  return path;
}

/** Removes 1 px staircases; the direction of the path must be known for the outset (`PathSimplify::remove_staircase`). */
export function removeStaircase(path: Point[], clockwise: boolean): Point[] {
  const len = path.length;
  const segmentLength = (i: number, j: number) => Math.abs(path[i]!.x - path[j]!.x) + Math.abs(path[i]!.y - path[j]!.y);
  const result: Point[] = [];
  for (let i = 0; i < len; i++) {
    const j = (i + 1) % len;
    const h = i > 0 ? i - 1 : len - 1;
    let keep = true;
    if (i !== 0 && i !== len - 1 && (segmentLength(i, h) === 1 || segmentLength(i, j) === 1)) {
      const area = signedArea(path[h]!, path[i]!, path[j]!);
      keep = area !== 0 && area > 0 === clockwise;
    }
    if (keep) result.push(path[i]!);
  }
  return result;
}

function penalty(a: Point, b: Point, c: Point): number {
  const length = (p: Point, q: Point) => Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2);
  const l1 = length(a, b);
  const l2 = length(b, c);
  const l3 = length(c, a);
  const p = (l1 + l2 + l3) / 2;
  const area = Math.sqrt(p * (p - l1) * (p - l2) * (p - l3));
  return (area * area) / l3;
}

/** Drops points as long as the triangles they span stay below the tolerance (`PathSimplify::limit_penalties`). */
export function limitPenalties(path: Point[]): Point[] {
  const tolerance = 1;
  const len = path.length;
  const pastDelta = (from: number, to: number) => {
    let max = 0;
    for (let i = from + 1; i < to; i++) max = maxIgnoringNaN(max, penalty(path[from]!, path[i]!, path[to]!));
    return max;
  };
  const result: Point[] = [];
  let last = 0;
  for (let i = 0; i < len; i++) {
    if (i === 0) result.push(path[i]!);
    else if (i === last + 1) continue;
    else if (pastDelta(last, i) >= tolerance) {
      last = i - 1;
      result.push(path[i - 1]!);
    }
    if (i === len - 1) result.push(path[i]!);
  }
  return result;
}

/** The outline as a closed polygon: walked, then staircases and small detours removed (`PathI32::image_to_path`). */
export function imageToPolygon(image: BinaryImage, clockwise: boolean): Point[] {
  return limitPenalties(removeStaircase(walkOutline(image, clockwise), clockwise));
}
