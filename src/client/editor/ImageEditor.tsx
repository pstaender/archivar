import { Loader } from "../icons";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createImage, type JimpImage } from "../../shared/image/jimp";
import { applyEdits } from "../../shared/image/pipeline";
import type { EditSettings, Point, Quad } from "../../shared/types";
import { type GeometryMode, moveCorner, quadOrFull, translateQuad } from "./geometry";
import { type LensPointer, Magnifier } from "./Magnifier";
import { loadOpenCv } from "./opencv";
import { PreviewBar } from "./PreviewBar";

// Filters behave differently on a downscaled image (thin strokes turn gray and fall below the threshold), so the
// preview is rendered from the full base image. Slow settings (colors, denoise) show a small draft while they change.
export const DRAFT_SIZE = 1200;
const RENDER_DELAY = 40;
const SETTLE_DELAY = 350;
const INSTANT_RENDER_MS = 250;

interface PreviewImages {
  full: JimpImage;
  draft: JimpImage;
}

async function loadPreview(url: string): Promise<PreviewImages> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const full = rasterize(img, 1);
  const scale = DRAFT_SIZE / Math.max(img.naturalWidth, img.naturalHeight);
  return { full, draft: scale < 1 ? rasterize(img, scale) : full };
}

function rasterize(img: HTMLImageElement, scale: number): JimpImage {
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
  /** Full-resolution render of the current settings; replaces the live preview while set. */
  processedSrc?: string | null;
  processing?: boolean;
  onPreview?: () => void;
  onLive?: () => void;
}

export function ImageEditor({ src, settings, mode, onCornersChange, processedSrc, processing = false, onPreview, onLive }: ImageEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processedRef = useRef<HTMLImageElement>(null);
  const [pointer, setPointer] = useState<LensPointer | null>(null);
  const [base, setBase] = useState<PreviewImages | null>(null);
  const fullRenderMs = useRef(Infinity);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBase(null);
    fullRenderMs.current = Infinity;
    loadPreview(src)
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
    const render = async (image: JimpImage) => {
      if (preview.denoise > 0) await loadOpenCv();
      if (cancelled || !canvasRef.current) return false;
      drawToCanvas(canvasRef.current, applyEdits(image, preview));
      return true;
    };
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    const instant = base.draft === base.full || fullRenderMs.current <= INSTANT_RENDER_MS;
    const draftTimer = instant ? undefined : setTimeout(() => render(base.draft).catch(fail), RENDER_DELAY);
    const fullTimer = setTimeout(
      async () => {
        try {
          const start = performance.now();
          if (await render(base.full)) fullRenderMs.current = performance.now() - start;
        } catch (e) {
          fail(e);
        }
        if (!cancelled) setRendering(false);
      },
      instant ? RENDER_DELAY : SETTLE_DELAY,
    );
    return () => {
      cancelled = true;
      clearTimeout(draftTimer);
      clearTimeout(fullTimer);
    };
  }, [base, settings, mode]);

  const showProcessed = Boolean(processedSrc) && mode === "none";

  useEffect(() => {
    if (!showProcessed) setPointer(null);
  }, [showProcessed]);

  if (error) return <div className="alert alert--error">Vorschau konnte nicht geladen werden: {error}</div>;

  return (
    <div className="editor-canvas">
      <div className="editor-canvas__stage">
        <canvas ref={canvasRef} className="editor-canvas__image" hidden={showProcessed} />
        {showProcessed && (
          <img
            ref={processedRef}
            src={processedSrc!}
            alt="Vorschau in voller Auflösung"
            className="editor-canvas__image is-inspecting"
            onPointerMove={(e) => e.pointerType === "mouse" && setPointer({ clientX: e.clientX, clientY: e.clientY })}
            onPointerLeave={() => setPointer(null)}
          />
        )}
        {base && mode !== "none" && (
          <QuadOverlay quad={quadOrFull(settings.corners)} mode={mode} onChange={onCornersChange} />
        )}
      </div>
      {showProcessed && pointer && <Magnifier source={processedRef} pointer={pointer} />}
      {onPreview && onLive && base && mode === "none" && (
        <PreviewBar processing={processing} showing={showProcessed} onPreview={onPreview} onLive={onLive} />
      )}
      {(!base || rendering || processing) && (
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
