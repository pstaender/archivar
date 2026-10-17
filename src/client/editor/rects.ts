/** A rectangle relative (0..1) to the image it is drawn on. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export type Point = { x: number; y: number };

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The rectangle spanned by two edges on each axis, whichever way round they are. */
export function fromEdges<T extends Rect>(rect: T, left: number, top: number, right: number, bottom: number): T {
  return { ...rect, x: Math.min(left, right), y: Math.min(top, bottom), width: Math.abs(right - left), height: Math.abs(bottom - top) };
}

export function resize<T extends Rect>(origin: T, handle: Handle, p: Point): T {
  let [left, top, right, bottom] = [origin.x, origin.y, origin.x + origin.width, origin.y + origin.height];
  if (handle.includes("w")) left = p.x;
  if (handle.includes("e")) right = p.x;
  if (handle.includes("n")) top = p.y;
  if (handle.includes("s")) bottom = p.y;
  return fromEdges(origin, left, top, right, bottom);
}

export function moveBy<T extends Rect>(origin: T, dx: number, dy: number): T {
  return { ...origin, x: clamp01(Math.min(1 - origin.width, origin.x + dx)), y: clamp01(Math.min(1 - origin.height, origin.y + dy)) };
}

/** The pointer position relative to the element. */
export function pointIn(element: HTMLElement, e: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect();
  return { x: clamp01((e.clientX - rect.left) / rect.width), y: clamp01((e.clientY - rect.top) / rect.height) };
}

/** Arrow keys move by 0.5 % (Shift: 5 %); with Alt they resize. Returns null for other keys. */
export function nudge<T extends Rect>(rect: T, e: { key: string; shiftKey: boolean; altKey: boolean }): T | null {
  const step = e.shiftKey ? 0.05 : 0.005;
  const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!delta) return null;
  const [dx, dy] = delta as [number, number];
  if (e.altKey) return fromEdges(rect, rect.x, rect.y, clamp01(rect.x + rect.width + dx), clamp01(rect.y + rect.height + dy));
  return moveBy(rect, dx, dy);
}
