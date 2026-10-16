import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ExternalLink, Maximize, ZoomIn, ZoomOut } from "../icons";
import { fitScale, formatZoom, type Zoom, zoomIn, zoomOut } from "../zoom";

interface ZoomableImageProps {
  src: string;
  alt: string;
}

export function ZoomableImage({ src, alt }: ZoomableImageProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const anchor = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);

  useEffect(() => setZoom("fit"), [src]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setAvailable({ width: el.clientWidth, height: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = fitScale(natural, available);
  const scale = zoom === "fit" ? fit : zoom;

  // Keeps the point under the anchor (viewport centre or clicked point) in place while zooming.
  const changeZoom = useCallback(
    (next: Zoom, point?: { x: number; y: number }) => {
      const el = scroller.current;
      if (el) {
        const x = point?.x ?? el.clientWidth / 2;
        const y = point?.y ?? el.clientHeight / 2;
        anchor.current = { fx: (el.scrollLeft + x) / Math.max(1, el.scrollWidth), fy: (el.scrollTop + y) / Math.max(1, el.scrollHeight), x, y };
      }
      setZoom(next);
    },
    [],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.fx * el.scrollWidth - a.x;
    el.scrollTop = a.fy * el.scrollHeight - a.y;
    anchor.current = null;
  }, [scale]);

  const onImageClick = (e: MouseEvent<HTMLImageElement>) => {
    const rect = scroller.current?.getBoundingClientRect();
    const point = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined;
    changeZoom(zoom === "fit" && fit < 1 ? 1 : "fit", point);
  };

  const zoomed = zoom !== "fit";
  const size = zoomed && natural.width > 0 ? { width: natural.width * scale, height: natural.height * scale } : undefined;

  return (
    <div className="zoomable">
      <div ref={scroller} className={`zoomable__scroller${zoomed ? " is-zoomed" : ""}`}>
        <img
          src={src}
          alt={alt}
          className={`zoomable__image${scale > 1 ? " is-magnified" : ""}`}
          style={size}
          onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
          onClick={onImageClick}
          data-zoomable={zoom === "fit" && fit < 1 ? "in" : "out"}
        />
      </div>
      <div className="zoom-bar" role="toolbar" aria-label="Zoom">
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => changeZoom(zoomOut(scale, fit))} disabled={zoom === "fit"} aria-label="Verkleinern" title="Verkleinern">
          <ZoomOut size={16} />
        </button>
        <span className="zoom-bar__value" aria-live="polite" aria-label="Zoomstufe">
          {formatZoom(scale)}
        </span>
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => changeZoom(zoomIn(scale))} disabled={scale >= 4} aria-label="Vergrößern" title="Vergrößern">
          <ZoomIn size={16} />
        </button>
        <span className="zoom-bar__divider" aria-hidden />
        <button type="button" className={`btn btn--ghost btn--sm${zoom === "fit" ? " is-active" : ""}`} onClick={() => changeZoom("fit")} aria-pressed={zoom === "fit"} title="Ganzes Bild anzeigen">
          <Maximize size={16} />
          Einpassen
        </button>
        <button type="button" className={`btn btn--ghost btn--sm${zoom === 1 ? " is-active" : ""}`} onClick={() => changeZoom(1)} aria-pressed={zoom === 1} title="Originalgröße">
          100 %
        </button>
        <a href={src} target="_blank" rel="noreferrer" className="btn btn--ghost btn--icon btn--sm" aria-label="In neuem Tab öffnen" title="In neuem Tab öffnen">
          <ExternalLink size={16} />
        </a>
      </div>
    </div>
  );
}
