import { Loader } from "../icons";
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import type { EditSettings, Point, Quad } from "../../shared/types";
import { type GeometryMode, moveCorner, quadOrFull, translateQuad } from "./geometry";
import { type LensPointer, Magnifier } from "./Magnifier";
import { PreviewBar } from "./PreviewBar";
import { PreviewRenderer, type RenderedPreview, RendererDisposedError } from "./previewRenderer";

// Filters behave differently on a downscaled image (thin strokes turn gray and fall below the threshold), so the
// preview is rendered from the full base image in a worker. Slow settings (colors, denoise) additionally get a small
// draft from a second worker while they change, so the full render only runs once they settle.
export const DRAFT_SIZE = 1200;
const RENDER_DELAY = 40;
const SETTLE_DELAY = 250;
const INSTANT_RENDER_MS = 250;

interface Renderers {
  full: PreviewRenderer;
  draft: PreviewRenderer | null;
}

function drawToCanvas(canvas: HTMLCanvasElement, { width, height, data }: RenderedPreview) {
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.putImageData(new ImageData(data, width, height), 0, 0);
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
  const [renderers, setRenderers] = useState<Renderers | null>(null);
  const fullRenderMs = useRef(Infinity);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const full = new PreviewRenderer();
    let draft: PreviewRenderer | null = null;
    setRenderers(null);
    setError(null);
    fullRenderMs.current = Infinity;
    full
      .load(src)
      .then(async ({ width, height }) => {
        if (cancelled) return;
        if (Math.max(width, height) > DRAFT_SIZE) {
          draft = new PreviewRenderer();
          await draft.load(src, DRAFT_SIZE);
        }
        if (!cancelled) setRenderers({ full, draft });
      })
      .catch((e) => !cancelled && !(e instanceof RendererDisposedError) && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      full.dispose();
      draft?.dispose();
    };
  }, [src]);

  useEffect(() => {
    if (!renderers) return;
    setRendering(true);
    let cancelled = false;
    let fullShown = false;
    const preview = mode === "none" ? settings : { ...settings, corners: null, denoise: 0 };
    const show = (result: RenderedPreview | null) => {
      if (!result || cancelled || !canvasRef.current) return false;
      drawToCanvas(canvasRef.current, result);
      return true;
    };
    // Switching to another image disposes the renderers while a render may still run.
    const fail = (e: unknown) => !cancelled && !(e instanceof RendererDisposedError) && setError(e instanceof Error ? e.message : String(e));
    const { full, draft } = renderers;
    const instant = !draft || fullRenderMs.current <= INSTANT_RENDER_MS;
    const draftTimer = instant
      ? undefined
      : setTimeout(() => draft.render(preview).then((result) => !fullShown && show(result), fail), RENDER_DELAY);
    const fullTimer = setTimeout(
      () =>
        full.render(preview).then((result) => {
          if (result) fullRenderMs.current = result.ms;
          if (!show(result)) return;
          fullShown = true;
          setRendering(false);
        }, fail),
      instant ? RENDER_DELAY : SETTLE_DELAY,
    );
    return () => {
      cancelled = true;
      clearTimeout(draftTimer);
      clearTimeout(fullTimer);
    };
  }, [renderers, settings, mode]);

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
        {renderers && mode !== "none" && (
          <QuadOverlay quad={quadOrFull(settings.corners)} mode={mode} onChange={onCornersChange} />
        )}
      </div>
      {showProcessed && pointer && <Magnifier source={processedRef} pointer={pointer} />}
      {onPreview && onLive && renderers && mode === "none" && (
        <PreviewBar processing={processing} showing={showProcessed} onPreview={onPreview} onLive={onLive} />
      )}
      {(!renderers || rendering || processing) && (
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
