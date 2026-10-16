import { type RefObject, useEffect, useRef } from "react";
import { formatZoom, lensPosition } from "../zoom";

export const LENS_SIZE = 240;

export interface LensPointer {
  clientX: number;
  clientY: number;
}

interface MagnifierProps {
  source: RefObject<HTMLImageElement | null>;
  pointer: LensPointer;
}

/** Shows the image around the cursor at 100 % (one image pixel per CSS pixel). */
export function Magnifier({ source, pointer }: MagnifierProps) {
  const lens = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const image = source.current;
    const target = lens.current;
    if (!image || !target || !image.naturalWidth) return;
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = ((pointer.clientX - rect.left) / rect.width) * image.naturalWidth;
    const y = ((pointer.clientY - rect.top) / rect.height) * image.naturalHeight;
    const dpr = window.devicePixelRatio || 1;
    target.width = Math.round(LENS_SIZE * dpr);
    target.height = Math.round(LENS_SIZE * dpr);
    const ctx = target.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(image, x - LENS_SIZE / 2, y - LENS_SIZE / 2, LENS_SIZE, LENS_SIZE, 0, 0, target.width, target.height);
  }, [source, pointer]);

  const { left, top } = lensPosition(pointer.clientX, pointer.clientY, LENS_SIZE, { width: window.innerWidth, height: window.innerHeight });
  return (
    <div className="magnifier" style={{ left, top, width: LENS_SIZE, height: LENS_SIZE }} aria-hidden>
      <canvas ref={lens} className="magnifier__canvas" />
      <span className="magnifier__label">{formatZoom(1)}</span>
    </div>
  );
}
