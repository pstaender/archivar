import { AutoCrop, AutoRotate, Contrast, Crop, Eraser, Loader, RotateCcw, RotateCw, Scan, WandSparkles } from "../icons";
import { type CSSProperties, useId } from "react";
import type { ColorMode, EditSettings } from "../../shared/types";
import { boundingRect, type GeometryMode, rotateSettings } from "./geometry";

interface EditControlsProps {
  settings: EditSettings;
  onChange: (settings: EditSettings) => void;
  mode: GeometryMode;
  onModeChange: (mode: GeometryMode) => void;
  dewarpAvailable?: boolean;
  dewarping?: boolean;
  onAutoDewarp?: () => void;
  autoBw?: AutoBwState | null;
  bwLoading?: boolean;
  onAutoBw?: () => void;
  rotating?: boolean;
  onAutoRotate?: () => void;
  cropping?: boolean;
  onAutoCrop?: () => void;
}

export interface AutoBwState {
  index: number;
  count: number;
  shade: "best" | "darker" | "lighter";
}

const SHADE_LABELS: Record<AutoBwState["shade"], string> = {
  best: "beste Schätzung",
  darker: "dunkler",
  lighter: "heller",
};

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "color", label: "Farbe" },
  { value: "grayscale", label: "Graustufen" },
  { value: "bw", label: "S/W" },
];

const DENOISE_LABELS = ["Aus", "Leicht", "Mittel", "Stark"];

export function EditControls({
  settings,
  onChange,
  mode,
  onModeChange,
  dewarpAvailable,
  dewarping,
  onAutoDewarp,
  autoBw,
  bwLoading,
  onAutoBw,
  rotating,
  onAutoRotate,
  cropping,
  onAutoCrop,
}: EditControlsProps) {
  const set = <K extends keyof EditSettings>(key: K, value: EditSettings[K]) => onChange({ ...settings, [key]: value });

  const rotate = (delta: 90 | -90) => onChange(rotateSettings(settings, delta));

  const toggleMode = (next: Exclude<GeometryMode, "none">) => {
    if (mode === next) return onModeChange("none");
    if (next === "crop" && settings.corners) set("corners", boundingRect(settings.corners));
    onModeChange(next);
  };

  return (
    <div className="edit-controls">
      <section className="control-group">
        <div className="control-group__header">
          <h3>Ausrichtung</h3>
          <div className="button-row">
            <button type="button" className="btn btn--sm btn--icon" onClick={() => rotate(-90)} aria-label="Nach links drehen" title="Nach links drehen">
              <RotateCcw size={16} />
            </button>
            <button type="button" className="btn btn--sm btn--icon" onClick={() => rotate(90)} aria-label="Nach rechts drehen" title="Nach rechts drehen">
              <RotateCw size={16} />
            </button>
          </div>
        </div>
        <div className="tool-grid">
          <button type="button" className={`btn btn--sm ${mode === "crop" ? "is-active" : ""}`} aria-pressed={mode === "crop"} onClick={() => toggleMode("crop")}>
            <Crop size={16} />
            Zuschneiden
          </button>
          <button
            type="button"
            className={`btn btn--sm ${mode === "perspective" ? "is-active" : ""}`}
            aria-pressed={mode === "perspective"}
            onClick={() => toggleMode("perspective")}
          >
            <Scan size={16} />
            Entzerren
          </button>
          {onAutoRotate && (
            <button type="button" className="btn btn--sm" onClick={onAutoRotate} disabled={rotating} title="Dreht das Bild so, dass der Text aufrecht steht">
              {rotating ? <Loader size={16} className="spin" /> : <AutoRotate size={16} />}
              Auto-Drehen
            </button>
          )}
          {onAutoCrop && (
            <button type="button" className="btn btn--sm" onClick={onAutoCrop} disabled={cropping} title="Sucht den Rand von Seite oder Foto und schneidet den Hintergrund ab">
              {cropping ? <Loader size={16} className="spin" /> : <AutoCrop size={16} />}
              Auto-Zuschnitt
            </button>
          )}
        </div>
        {(rotating || cropping) && (
          <p className="muted small" aria-live="polite">
            {rotating ? "Textausrichtung wird erkannt …" : "Seitenrand wird gesucht …"}
          </p>
        )}
        {dewarpAvailable && (
          <div className="dewarp-row">
            <button
              type="button"
              className={`btn btn--sm ${settings.dewarp ? "is-active" : ""}`}
              aria-pressed={Boolean(settings.dewarp)}
              onClick={() => (settings.dewarp ? onChange({ ...settings, dewarp: null, corners: null }) : onAutoDewarp?.())}
              disabled={dewarping}
            >
              {dewarping ? <Loader size={16} className="spin" /> : <WandSparkles size={16} />}
              Automatisch entzerren
            </button>
            <span className="muted small">
              {dewarping ? "Seite wird erkannt …" : settings.dewarp ? "Gewölbte Seite geglättet." : "Glättet gewölbte Seiten (UVDoc)."}
            </span>
          </div>
        )}
        {mode !== "none" && (
          <p className="muted small">
            {mode === "crop"
              ? "Ecken ziehen, um den Ausschnitt festzulegen."
              : "Ecken auf die Ecken des Dokuments ziehen – es wird gerade gerückt."}
            {settings.corners && (
              <>
                {" "}
                <button type="button" className="link-button" onClick={() => set("corners", null)}>
                  Zurücksetzen
                </button>
              </>
            )}
          </p>
        )}
        {mode === "none" && settings.corners && (
          <p className="muted small">
            Ausschnitt aktiv.{" "}
            <button type="button" className="link-button" onClick={() => set("corners", null)}>
              Entfernen
            </button>
          </p>
        )}
      </section>

      <section className="control-group">
        <h3>Licht</h3>
        <Slider label="Helligkeit" value={settings.brightness} min={-1} max={1} step={0.01} format={percent} onChange={(v) => set("brightness", v)} />
        <Slider label="Kontrast" value={settings.contrast} min={-1} max={1} step={0.01} format={percent} onChange={(v) => set("contrast", v)} />
        <label className="switch">
          <input type="checkbox" checked={settings.autoLevels} onChange={(e) => set("autoLevels", e.target.checked)} />
          <span className="switch__track" aria-hidden />
          <span>Tonwerte automatisch</span>
        </label>
      </section>

      <section className="control-group">
        <h3>Farbe</h3>
        {onAutoBw && (
          <div className="dewarp-row">
            <button type="button" className={`btn btn--sm ${autoBw ? "is-active" : ""}`} aria-pressed={Boolean(autoBw)} onClick={onAutoBw} disabled={bwLoading}>
              {bwLoading ? <Loader size={16} className="spin" /> : <Contrast size={16} />}
              Automatisch SW
            </button>
            <span className="muted small" aria-live="polite">
              {bwLoading
                ? "Werte werden ermittelt …"
                : autoBw
                  ? `Variante ${autoBw.index + 1} von ${autoBw.count} · ${SHADE_LABELS[autoBw.shade]}${autoBw.count > 1 ? " – erneut klicken für die nächste." : "."}`
                  : "Ermittelt Helligkeit, Kontrast und Schwelle."}
            </span>
          </div>
        )}
        <div className="segmented" role="radiogroup" aria-label="Farbmodus">
          {COLOR_MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={settings.colorMode === option.value}
              className={settings.colorMode === option.value ? "is-active" : ""}
              onClick={() => set("colorMode", option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {settings.colorMode === "color" && (
          <>
            <Slider label="Sättigung" value={settings.saturation} min={-100} max={100} step={1} format={signed} onChange={(v) => set("saturation", v)} />
            <Slider label="Farbton" value={settings.hue} min={-180} max={180} step={1} format={(v) => `${signed(v)}°`} onChange={(v) => set("hue", v)} />
          </>
        )}
        {settings.colorMode === "bw" && (
          <Slider label="Schwelle" value={settings.bwThreshold} min={0} max={255} step={1} defaultValue={128} onChange={(v) => set("bwThreshold", v)} />
        )}
      </section>

      <section className="control-group">
        <h3>Störungen entfernen</h3>
        <div className="dewarp-row">
          <button
            type="button"
            className={`btn btn--sm ${settings.denoise > 0 ? "is-active" : ""}`}
            aria-pressed={settings.denoise > 0}
            onClick={() => set("denoise", (settings.denoise + 1) % DENOISE_LABELS.length)}
          >
            <Eraser size={16} />
            Entrauschen
          </button>
          <span className="muted small" aria-live="polite">
            {settings.denoise > 0
              ? `Stärke: ${DENOISE_LABELS[settings.denoise]} – ${settings.denoise < DENOISE_LABELS.length - 1 ? "erneut klicken für stärker." : "erneut klicken zum Ausschalten."}`
              : "Glättet Rauschen und entfernt im S/W-Modus einzelne Punkte."}
          </span>
        </div>
      </section>
    </div>
  );
}

const percent = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)} %`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}`;

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

export function Slider({ label, value, min, max, step, defaultValue = 0, format = String, onChange }: SliderProps) {
  const id = useId();
  return (
    <div className="slider">
      <div className="slider__header">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="slider__value">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </div>
  );
}
