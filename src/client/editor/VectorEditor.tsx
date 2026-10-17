import { Eye, Loader, Trash, WandSparkles } from "../icons";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { MAX_DETAIL, MIN_AREA_SIZE, MIN_DETAIL, type VectorArea, type VectorSettings } from "../../vectorizer";
import { Slider } from "./EditControls";
import { fromEdges, HANDLES, type Handle, moveBy, nudge, type Point, pointIn, type Rect, resize } from "./rects";
import type { VectorAreasState } from "./useVectorAreas";

type Drag =
  | { kind: "create"; id: string; anchor: Point }
  | { kind: "move"; id: string; start: Point; origin: VectorArea }
  | { kind: "resize"; id: string; handle: Handle; origin: VectorArea };

const tooSmall = (r: Rect) => r.width < MIN_AREA_SIZE || r.height < MIN_AREA_SIZE;

const DETAIL_LABELS = ["Sehr grob", "Grob", "Mittel", "Fein", "Sehr fein"];

interface VectorCanvasProps {
  src: string;
  alt: string;
  state: VectorAreasState;
  showOriginal: boolean;
}

/** The edited image with the vectorized areas on top: drag on the image to mark an area, drag an area to move it. */
export function VectorCanvas({ src, alt, state, showOriginal }: VectorCanvasProps) {
  const { areas, selected, setAreas, setSelected, setDragging } = state;
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const toPoint = (e: PointerEvent): Point => pointIn(overlay.current!, e);
  const replace = (area: VectorArea) => setAreas((list) => list.map((a) => (a.id === area.id ? area : a)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = toPoint(e);
    const areaId = target.closest<HTMLElement>("[data-area-id]")?.dataset.areaId;
    const area = areas.find((a) => a.id === areaId);
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragging(true);
    if (area) {
      const handle = target.dataset.handle as Handle | undefined;
      drag.current = handle ? { kind: "resize", id: area.id, handle, origin: area } : { kind: "move", id: area.id, start: p, origin: area };
      setSelected(area.id);
      target.closest<HTMLElement>("[data-area-id]")?.focus();
      return;
    }
    const created = state.create({ x: p.x, y: p.y, width: 0, height: 0 });
    drag.current = { kind: "create", id: created.id, anchor: p };
    setAreas((list) => [...list, created]);
    setSelected(created.id);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const p = toPoint(e);
    const area = areas.find((a) => a.id === current.id);
    if (!area) return;
    if (current.kind === "create") replace(fromEdges(area, current.anchor.x, current.anchor.y, p.x, p.y));
    else if (current.kind === "move") replace(moveBy(current.origin, p.x - current.start.x, p.y - current.start.y));
    else replace(resize(current.origin, current.handle, p));
  };

  const end = () => {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;
    const area = areas.find((a) => a.id === current.id);
    if (!area || !tooSmall(area)) return;
    // A click without dragging: no area, and a resize to nothing restores it.
    if (current.kind === "create") {
      setAreas((list) => list.filter((a) => a.id !== area.id));
      setSelected(null);
    } else replace(current.origin);
  };

  const keyDown = (e: KeyboardEvent<HTMLElement>, area: VectorArea) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      setAreas((list) => list.filter((a) => a.id !== area.id));
      setSelected(null);
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      (e.target as HTMLElement).blur();
      return;
    }
    const next = nudge(area, e);
    if (!next) return;
    e.preventDefault();
    if (!tooSmall(next)) replace(next);
  };

  return (
    <div className="editor-canvas">
      <div className="editor-canvas__stage">
        <img src={src} alt={alt} className="editor-canvas__image" draggable={false} />
        <div ref={overlay} className="shape-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          {areas.map((area, index) => {
            const graphic = !showOriginal && state.showsGraphic(area) ? area.graphic : null;
            const busy = state.working?.id === area.id;
            return (
              <button
                key={area.id}
                type="button"
                data-area-id={area.id}
                className={`shape vector-area ${area.id === selected ? "is-selected" : ""}`}
                style={{ left: `${area.x * 100}%`, top: `${area.y * 100}%`, width: `${area.width * 100}%`, height: `${area.height * 100}%` }}
                aria-label={`Vektorbereich ${index + 1}`}
                aria-pressed={area.id === selected}
                aria-busy={busy}
                onFocus={() => setSelected(area.id)}
                onKeyDown={(e) => keyDown(e, area)}
              >
                {graphic && (
                  <svg className="vector-area__graphic" viewBox={`0 0 ${graphic.width} ${graphic.height}`} preserveAspectRatio="none" aria-hidden>
                    <rect width={graphic.width} height={graphic.height} fill={graphic.background} />
                    {graphic.paths.map((path, i) => (
                      <path key={i} d={path.d} fill={path.fill} />
                    ))}
                  </svg>
                )}
                {busy && (
                  <span className="vector-area__busy">
                    <Loader size={16} className="spin" />
                  </span>
                )}
                {area.id === selected && HANDLES.map((handle) => <span key={handle} data-handle={handle} className={`shape__handle shape__handle--${handle}`} />)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface VectorControlsProps {
  state: VectorAreasState;
  showOriginal: boolean;
  onShowOriginal: (show: boolean) => void;
  /** The image has recognized text, which is recognized again after saving. */
  hasText: boolean;
  onSave: () => void;
}

export function VectorControls({ state, showOriginal, onShowOriginal, hasText, onSave }: VectorControlsProps) {
  const { areas, selected, working, dirty, saving, pending } = state;
  const area = areas.find((a) => a.id === selected) ?? null;
  const set = <K extends keyof VectorSettings>(key: K, value: VectorSettings[K]) => area && state.changeSettings(area.id, { ...area.settings, [key]: value });
  const vectorized = areas.filter((a) => a.graphic !== null).length;

  return (
    <>
      <div className="edit-controls">
        {state.outdated && (
          <div className="alert alert--warning small">
            Zuschnitt, Drehung oder Entzerrung wurden nach dem Vektorisieren geändert. Prüfe, ob die Bereiche noch an der richtigen Stelle liegen.
          </div>
        )}
        <section className="control-group">
          <h3>Bereiche</h3>
          <p className="muted small">
            Auf dem Bild einen Bereich aufziehen: Er wird mit passenden Einstellungen vektorisiert und ersetzt beim Speichern die Pixel des Bildes. Bereiche lassen
            sich verschieben, an den Griffen in der Größe ändern und mit Entf löschen.
          </p>
          <div className="button-row">
            {area && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  state.setAreas((list) => list.filter((a) => a.id !== area.id));
                  state.setSelected(null);
                }}
              >
                <Trash size={16} />
                Bereich löschen
              </button>
            )}
            {areas.length > 0 && (
              <button type="button" className="btn btn--sm" aria-pressed={showOriginal} onClick={() => onShowOriginal(!showOriginal)}>
                <Eye size={16} />
                {showOriginal ? "Vektoren zeigen" : "Original zeigen"}
              </button>
            )}
            {areas.length > 0 && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  state.setAreas([]);
                  state.setSelected(null);
                }}
              >
                Alle entfernen
              </button>
            )}
          </div>
          <p className="muted small" aria-live="polite">
            {areas.length === 0
              ? "Noch keine Bereiche."
              : `${areas.length === 1 ? "1 Bereich" : `${areas.length} Bereiche`}, ${vectorized} vektorisiert`}
          </p>
        </section>

        {area && (
          <section className="control-group">
            <h3>Vektorisierung</h3>
            <div className="segmented" role="radiogroup" aria-label="Farben">
              {(
                [
                  ["bw", "Schwarzweiß"],
                  ["color", "Farben"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={area.settings.mode === value} className={area.settings.mode === value ? "is-active" : ""} onClick={() => set("mode", value)}>
                  {label}
                </button>
              ))}
            </div>
            <Slider
              label="Details"
              value={area.settings.detail}
              min={MIN_DETAIL}
              max={MAX_DETAIL}
              step={1}
              defaultValue={3}
              format={(v) => DETAIL_LABELS[v - 1] ?? String(v)}
              onChange={(v) => set("detail", v)}
            />
            {area.settings.mode === "bw" && (
              <Slider label="Schwelle" value={area.settings.threshold} min={1} max={254} step={1} defaultValue={128} onChange={(v) => set("threshold", v)} />
            )}
            <div className="segmented" role="radiogroup" aria-label="Kanten">
              {(
                [
                  ["smooth", "Glatt"],
                  ["sharp", "Eckig"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={area.settings.curves === value} className={area.settings.curves === value ? "is-active" : ""} onClick={() => set("curves", value)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="button-row">
              <button type="button" className="btn btn--sm" onClick={() => state.resuggest(area.id)} disabled={working?.id === area.id && working.step === "suggest"}>
                <WandSparkles size={16} />
                Automatisch einstellen
              </button>
              {working?.id === area.id && working.step === "vectorize" && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={state.cancel}>
                  Abbrechen
                </button>
              )}
            </div>
            <p className="muted small" aria-live="polite">
              {working?.id === area.id
                ? working.step === "suggest"
                  ? "Einstellungen werden ermittelt …"
                  : "Wird vektorisiert …"
                : state.failedIds.has(area.id)
                  ? "Nicht vektorisiert – Einstellungen ändern, um es erneut zu versuchen."
                  : area.graphic && state.isCurrent(area)
                    ? `${area.graphic.paths.length === 1 ? "1 Form" : `${area.graphic.paths.length} Formen`}${state.lastMs !== null ? ` · ${(state.lastMs / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })} s` : ""}`
                    : ""}
            </p>
          </section>
        )}
        {hasText && <p className="muted small">Nach dem Speichern wird der Text neu erkannt.</p>}
      </div>
      <div className="panel__footer">
        <span className="spacer saving-hint">
          {(saving || pending) && (
            <span className="muted small" role="status">
              <Loader size={14} className="spin" /> {saving ? "Speichert …" : "Vektorisiert …"}
            </span>
          )}
        </span>
        <button type="button" className="btn btn--sm" onClick={state.discard} disabled={(!dirty && !pending) || saving}>
          Verwerfen
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={onSave} disabled={!dirty || saving || pending}>
          Speichern
        </button>
      </div>
    </>
  );
}
