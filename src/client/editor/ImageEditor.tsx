import { Loader } from "../icons";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createImage, type JimpImage } from "../../shared/image/jimp";
import { applyEdits } from "../../shared/image/pipeline";
import type { EditSettings, Point, Quad } from "../../shared/types";
import { type GeometryMode, moveCorner, quadOrFull, translateQuad } from "./geometry";
import { loadOpenCv } from "./opencv";

export const PREVIEW_MAX_SIZE = 1400;
const RENDER_DELAY = 40;

async function loadPreview(url: string, maxSize: number): Promise<JimpImage> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, width, height);
  return createImage(width, height, ctx.getImageData(0, 0, width, height).data);
}

function drawToCanvas(canvas: HTMLCanvasElement, image: JimpImage) {
  const { width, height, data } = image.bitmap;
  canvas.width = width;
  canvas.height = height;
  const pixels = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  canvas.getContext("2d")!.putImageData(new ImageData(pixels, width, height), 0, 0);
}

interface ImageEditorProps {
  src: string;
  settings: EditSettings;
  mode: GeometryMode;
  onCornersChange: (corners: Quad) => void;
}

export function ImageEditor({ src, settings, mode, onCornersChange }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<JimpImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBase(null);
    loadPreview(src, PREVIEW_MAX_SIZE)
      .then((image) => !cancelled && setBase(image))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (!base || !canvasRef.current) return;
    setRendering(true);
    let cancelled = false;
    const preview = mode === "none" ? settings : { ...settings, corners: null, denoise: 0 };
    const timer = setTimeout(async () => {
      try {
        if (preview.denoise > 0) await loadOpenCv();
        if (cancelled || !canvasRef.current) return;
        drawToCanvas(canvasRef.current, applyEdits(base, preview));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) setRendering(false);
    }, RENDER_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, settings, mode]);

  if (error) return <div className="alert alert--error">Vorschau konnte nicht geladen werden: {error}</div>;

  return (
    <div className="editor-canvas">
      <div className="editor-canvas__stage">
        <canvas ref={canvasRef} className="editor-canvas__image" />
        {base && mode !== "none" && (
          <QuadOverlay quad={quadOrFull(settings.corners)} mode={mode} onChange={onCornersChange} />
        )}
      </div>
      {(!base || rendering) && (
        <span className="editor-canvas__spinner" aria-label="Vorschau wird berechnet">
          <Loader size={18} className="spin" />
        </span>
      )}
    </div>
  );
}

interface QuadOverlayProps {
  quad: Quad;
  mode: Exclude<GeometryMode, "none">;
  onChange: (quad: Quad) => void;
}

type Drag = { kind: "corner"; index: number } | { kind: "move"; start: Point; quad: Quad };

export function QuadOverlay({ quad, mode, onChange }: QuadOverlayProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const toPoint = (e: ReactPointerEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const start = (e: ReactPointerEvent, next: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = next;
  };

  const move = (e: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const p = toPoint(e);
    if (current.kind === "corner") onChange(moveCorner(quad, current.index, p, mode));
    else onChange(translateQuad(current.quad, p.x - current.start.x, p.y - current.start.y));
  };

  const end = () => {
    drag.current = null;
  };

  const points = quad.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div ref={ref} className="quad-overlay" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="quad-overlay__svg" aria-hidden>
        <defs>
          <mask id="quad-mask">
            <rect x="0" y="0" width="1" height="1" fill="white" />
            <polygon points={points} fill="black" />
          </mask>
        </defs>
        <rect x="0" y="0" width="1" height="1" className="quad-overlay__shade" mask="url(#quad-mask)" />
        <polygon
          points={points}
          className="quad-overlay__area"
          onPointerDown={(e) => start(e, { kind: "move", start: toPoint(e), quad })}
        />
      </svg>
      {quad.map((p, index) => (
        <button
          key={index}
          type="button"
          className="quad-overlay__handle"
          style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
          onPointerDown={(e) => start(e, { kind: "corner", index })}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 0.05 : 0.005;
            const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
            if (!delta) return;
            e.preventDefault();
            onChange(moveCorner(quad, index, { x: p.x + delta[0]!, y: p.y + delta[1]! }, mode));
          }}
          aria-label={`Ecke ${index + 1} verschieben`}
        />
      ))}
    </div>
  );
}
