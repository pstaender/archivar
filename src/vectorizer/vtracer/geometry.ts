/** Geometry helpers of visioncortex (`point.rs`, `bound.rs`, `path/util.rs`). */

export interface Point {
  x: number;
  y: number;
}

export const point = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y;

/** Rust's `f64::is_sign_negative`: also true for -0. */
export const isSignNegative = (n: number): boolean => n < 0 || Object.is(n, -0);

/** Rust's `f64::max`, which ignores NaN (Math.max propagates it). */
export const maxIgnoringNaN = (a: number, b: number): number => (Number.isNaN(b) ? a : Number.isNaN(a) ? b : Math.max(a, b));

export function norm(p: Point): number {
  return Math.sqrt(p.x * p.x + p.y * p.y);
}

export function normalize(p: Point): Point {
  const n = norm(p);
  return { x: p.x / n, y: p.y / n };
}

/** Angle of a unit vector in (-π, π]. */
export function angle(p: Point): number {
  return isSignNegative(p.y) ? -Math.acos(p.x) : Math.acos(p.x);
}

/** Signed difference of two angles in (-π, π]; positive is clockwise (y points down). */
export function signedAngleDifference(from: number, to: number): number {
  let v2 = to;
  if (from > v2) v2 += 2 * Math.PI;
  const diff = v2 - from;
  return diff > Math.PI ? diff - 2 * Math.PI : diff;
}

export function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const negligible = (v: number) => -1e-7 < v && v < 1e-7;

/** Intersection of the lines (p1, p2) and (p3, p4); the mid point of (p1, p2) if they coincide, null if parallel. */
export function findIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
  const numera = (p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x);
  const numerb = (p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x);
  if (negligible(denom) && negligible(numera) && negligible(numerb)) return midPoint(p1, p2);
  if (negligible(denom)) return null;
  const mua = numera / denom;
  return { x: p1.x + mua * (p2.x - p1.x), y: p1.y + mua * (p2.y - p1.y) };
}

/** > 0 means clockwise with the origin at the top left. */
export function signedArea(p1: Point, p2: Point, p3: Point): number {
  return (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
}

/** Integer bounding rectangle; `right`/`bottom` are exclusive. */
export class BoundingRect {
  constructor(
    public left = 0,
    public top = 0,
    public right = 0,
    public bottom = 0,
  ) {}

  get width(): number {
    return this.right - this.left;
  }

  get height(): number {
    return this.bottom - this.top;
  }

  isEmpty(): boolean {
    return this.width === 0 && this.height === 0;
  }

  addXY(x: number, y: number): void {
    if (this.isEmpty()) {
      this.left = x;
      this.right = x + 1;
      this.top = y;
      this.bottom = y + 1;
      return;
    }
    if (x < this.left) this.left = x;
    else if (x + 1 > this.right) this.right = x + 1;
    if (y < this.top) this.top = y;
    else if (y + 1 > this.bottom) this.bottom = y + 1;
  }

  merge(other: BoundingRect): void {
    if (other.isEmpty()) return;
    if (this.isEmpty()) {
      this.left = other.left;
      this.right = other.right;
      this.top = other.top;
      this.bottom = other.bottom;
      return;
    }
    this.left = Math.min(this.left, other.left);
    this.right = Math.max(this.right, other.right);
    this.top = Math.min(this.top, other.top);
    this.bottom = Math.max(this.bottom, other.bottom);
  }

  clear(): void {
    this.left = this.top = this.right = this.bottom = 0;
  }

  clone(): BoundingRect {
    return new BoundingRect(this.left, this.top, this.right, this.bottom);
  }
}
