import { type RefObject, useEffect, useRef } from "react";
import { formatZoom, lensPosition } from "../zoom";

export const LENS_SIZE = 220;

export interface LensPointer {
  clientX: number;
  clientY: number;
}

interface MagnifierProps {
  source: RefObject<HTMLCanvasElement | null>;
  pointer: LensPointer;
  version: number;
}

/** Shows the preview canvas at 100 % (one canvas pixel per CSS pixel) around the cursor. */
export function Magnifier({ source, pointer, version }: MagnifierProps) {
  const lens = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = source.current;
    const target = lens.current;
    if (!canvas || !target) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((pointer.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((pointer.clientY - rect.top) / rect.height) * canvas.height;
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.round(LENS_SIZE * dpr);
    target.height = Math.round(LENS_SIZE * dpr);
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(canvas, x - LENS_SIZE / 2, y - LENS_SIZE / 2, LENS_SIZE, LENS_SIZE, 0, 0, target.width, target.height);
  }, [source, pointer, version]);

  const { left, top } = lensPosition(pointer.clientX, pointer.clientY, LENS_SIZE, { width: window.innerWidth, height: window.innerHeight });
  return (
    <div className="magnifier" style={{ left, top, width: LENS_SIZE, height: LENS_SIZE }} aria-hidden>
      <canvas ref={lens} className="magnifier__canvas" />
      <span className="magnifier__label">{formatZoom(1)}</span>
    </div>
  );
}
