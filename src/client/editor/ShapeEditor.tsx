import { Loader, Plus, SavePlus, Trash } from "../icons";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";
import { MIN_SHAPE_SIZE, SHAPE_COLORS, type Shape } from "../../shared/shapes";
import { fromEdges, HANDLES, type Handle, moveBy, nudge, type Point, pointIn, resize } from "./rects";
import { useTranslation } from "react-i18next";

type Drag =
  | { kind: "create"; id: string; anchor: Point }
  | { kind: "move"; id: string; start: Point; origin: Shape }
  | { kind: "resize"; id: string; handle: Handle; origin: Shape };

let created = 0;
const newId = () => `r${Date.now().toString(36)}${(created++).toString(36)}`;

const tooSmall = (shape: Shape) => shape.width < MIN_SHAPE_SIZE || shape.height < MIN_SHAPE_SIZE;

interface ShapeCanvasProps {
  src: string;
  alt: string;
  shapes: Shape[];
  selected: string | null;
  /** Colour of new rectangles. */
  color: string;
  onChange: (shapes: Shape[]) => void;
  onSelect: (id: string | null) => void;
}

/** The edited image with its rectangles: drag on the image to draw one, drag a rectangle to move it, its handles to resize it. */
export function ShapeCanvas({ src, alt, shapes, selected, color, onChange, onSelect }: ShapeCanvasProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const { t } = useTranslation();

  const toPoint = (e: PointerEvent): Point => pointIn(overlay.current!, e);

  const replace = (shape: Shape) => onChange(shapes.map((s) => (s.id === shape.id ? shape : s)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const p = toPoint(e);
    const shapeId = target.closest<HTMLElement>("[data-shape-id]")?.dataset.shapeId;
    const shape = shapes.find((s) => s.id === shapeId);
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (shape) {
      const handle = target.dataset.handle as Handle | undefined;
      drag.current = handle ? { kind: "resize", id: shape.id, handle, origin: shape } : { kind: "move", id: shape.id, start: p, origin: shape };
      onSelect(shape.id);
      target.closest<HTMLElement>("[data-shape-id]")?.focus();
      return;
    }
    const id = newId();
    drag.current = { kind: "create", id, anchor: p };
    onChange([...shapes, { id, type: "rect", x: p.x, y: p.y, width: 0, height: 0, color }]);
    onSelect(id);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const p = toPoint(e);
    const shape = shapes.find((s) => s.id === current.id);
    if (!shape) return;
    if (current.kind === "create") replace(fromEdges(shape, current.anchor.x, current.anchor.y, p.x, p.y));
    else if (current.kind === "move") replace(moveBy(current.origin, p.x - current.start.x, p.y - current.start.y));
    else replace(resize(current.origin, current.handle, p));
  };

  const end = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    const shape = shapes.find((s) => s.id === current.id);
    if (!shape || !tooSmall(shape)) return;
    // A click without dragging: no rectangle, and a resize to nothing restores it.
    if (current.kind === "create") {
      onChange(shapes.filter((s) => s.id !== shape.id));
      onSelect(null);
    } else replace(current.origin);
  };

  const keyDown = (e: KeyboardEvent<HTMLElement>, shape: Shape) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onChange(shapes.filter((s) => s.id !== shape.id));
      onSelect(null);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onSelect(null);
      (e.target as HTMLElement).blur();
      return;
    }
    const next = nudge(shape, e);
    if (!next) return;
    e.preventDefault();
    if (!tooSmall(next)) replace(next);
  };

  return (
    <div className="editor-canvas">
      <div className="editor-canvas__stage">
        <img src={src} alt={alt} className="editor-canvas__image" draggable={false} />
        <div ref={overlay} className="shape-overlay" onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
          {shapes.map((shape, index) => (
            <button
              key={shape.id}
              type="button"
              data-shape-id={shape.id}
              className={`shape ${shape.id === selected ? "is-selected" : ""}`}
              style={{
                left: `${shape.x * 100}%`,
                top: `${shape.y * 100}%`,
                width: `${shape.width * 100}%`,
                height: `${shape.height * 100}%`,
                background: shape.color,
              }}
              aria-label={t("shapes.rectangle", { number: index + 1 })}
              aria-pressed={shape.id === selected}
              onFocus={() => onSelect(shape.id)}
              onKeyDown={(e) => keyDown(e, shape)}
            >
              {shape.id === selected && HANDLES.map((handle) => <span key={handle} data-handle={handle} className={`shape__handle shape__handle--${handle}`} />)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface ShapeControlsProps {
  shapes: Shape[];
  selected: string | null;
  color: string;
  outdated: boolean;
  /** The image has recognized text, which is recognized again after saving. */
  hasText: boolean;
  dirty: boolean;
  saving: boolean;
  onColorChange: (color: string) => void;
  onChange: (shapes: Shape[]) => void;
  onSelect: (id: string | null) => void;
  onSave: () => void;
  onDiscard: () => void;
  /** Offers the rectangles as a step of a new image preset. */
  onSavePreset?: () => void;
}

export function ShapeControls({
  shapes,
  selected,
  color,
  outdated,
  hasText,
  dirty,
  saving,
  onColorChange,
  onChange,
  onSelect,
  onSave,
  onDiscard,
  onSavePreset,
}: ShapeControlsProps) {
  const { t } = useTranslation();
  const selectedShape = shapes.find((s) => s.id === selected) ?? null;
  const current = selectedShape?.color ?? color;
  const custom = !SHAPE_COLORS.some((c) => c.color === current);

  const setColor = (next: string) => {
    onColorChange(next);
    if (selectedShape) onChange(shapes.map((s) => (s.id === selectedShape.id ? { ...s, color: next } : s)));
  };

  return (
    <>
      <div className="edit-controls">
        {outdated && (
          <div className="alert alert--warning small">
            {t("shapes.outdated")}
          </div>
        )}
        <section className="control-group">
          <h3>{t("shapes.title")}</h3>
          <p className="muted small">
            {t("shapes.intro")}
          </p>
          <div className="button-row">
            {selectedShape && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  onChange(shapes.filter((s) => s.id !== selectedShape.id));
                  onSelect(null);
                }}
              >
                <Trash size={16} />
                {t("shapes.delete")}
              </button>
            )}
            {shapes.length > 0 && onSavePreset && (
              <button
                type="button"
                className="btn btn--sm"
                onClick={onSavePreset}
                title={t("shapes.savePresetTitle")}
              >
                <SavePlus size={16} />
                {t("shapes.savePreset")}
              </button>
            )}
            {shapes.length > 0 && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => {
                  onChange([]);
                  onSelect(null);
                }}
              >
                {t("shapes.removeAll")}
              </button>
            )}
          </div>
          <p className="muted small" aria-live="polite">
            {shapes.length === 0 ? t("shapes.none") : t("shapes.count", { count: shapes.length })}
          </p>
        </section>
        <section className="control-group">
          <h3>{selectedShape ? t("shapes.colorSelected") : t("shapes.colorNew")}</h3>
          <div className="swatches" role="radiogroup" aria-label={t("shapes.color")}>
            {SHAPE_COLORS.map(({ color: value, name }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={current === value}
                aria-label={t(`shapeColors.${name}`)}
                title={t(`shapeColors.${name}`)}
                className={`swatch ${current === value ? "is-active" : ""}`}
                style={{ background: value }}
                onClick={() => setColor(value)}
              />
            ))}
            <label
              className={`swatch swatch--custom ${custom ? "is-active" : ""}`}
              title={t("shapes.customColor")}
              style={custom ? { background: current } : undefined}
            >
              {!custom && <Plus size={16} aria-hidden />}
              <input type="color" value={current} onChange={(e) => setColor(e.target.value)} aria-label={t("shapes.customColor")} />
            </label>
          </div>
        </section>
        {hasText && <p className="muted small">{t("shapes.ocrHint")}</p>}
      </div>
      <div className="panel__footer">
        <span className="spacer saving-hint">
          {saving && (
            <span className="muted small" role="status">
              <Loader size={14} className="spin" /> {t("shapes.saving")}
            </span>
          )}
        </span>
        <button type="button" className="btn btn--sm" onClick={onDiscard} disabled={!dirty || saving}>
          {t("unsaved.discard")}
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={onSave} disabled={!dirty || saving}>
          {t("common.save")}
        </button>
      </div>
    </>
  );
}
