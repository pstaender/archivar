export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export type Zoom = number | "fit";

export function zoomIn(current: number): number {
  return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
}

/** Zooming out below the fitted size goes back to fitting the image. */
export function zoomOut(current: number, fit: number): Zoom {
  const step = [...ZOOM_STEPS].reverse().find((s) => s < current - 1e-6);
  return step === undefined || step <= fit + 1e-6 ? "fit" : step;
}

export function fitScale(natural: { width: number; height: number }, available: { width: number; height: number }): number {
  if (natural.width <= 0 || natural.height <= 0 || available.width <= 0 || available.height <= 0) return 1;
  return Math.min(1, available.width / natural.width, available.height / natural.height);
}

export const formatZoom = (scale: number) => `${Math.round(scale * 100)} %`;
