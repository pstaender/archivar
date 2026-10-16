import { Crop, RotateCcw, RotateCw, Scan } from "lucide-react";
import { type CSSProperties, useId } from "react";
import { rotateBy } from "../../shared/editSettings";
import type { ColorMode, EditSettings } from "../../shared/types";
import { boundingRect, type GeometryMode, rotateQuad } from "./geometry";

interface EditControlsProps {
  settings: EditSettings;
  onChange: (settings: EditSettings) => void;
  mode: GeometryMode;
  onModeChange: (mode: GeometryMode) => void;
}

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "color", label: "Farbe" },
  { value: "grayscale", label: "Graustufen" },
  { value: "bw", label: "S/W" },
];

const DENOISE_LABELS = ["Aus", "Leicht", "Mittel", "Stark"];

export function EditControls({ settings, onChange, mode, onModeChange }: EditControlsProps) {
  const set = <K extends keyof EditSettings>(key: K, value: EditSettings[K]) => onChange({ ...settings, [key]: value });

  const rotate = (delta: 90 | -90) =>
    onChange({
      ...settings,
      rotation: rotateBy(settings.rotation, delta),
      corners: settings.corners ? rotateQuad(settings.corners, delta) : null,
    });

  const toggleMode = (next: Exclude<GeometryMode, "none">) => {
    if (mode === next) return onModeChange("none");
    if (next === "crop" && settings.corners) set("corners", boundingRect(settings.corners));
    onModeChange(next);
  };

  return (
    <div className="edit-controls">
      <section className="control-group">
        <h3>Ausrichtung</h3>
        <div className="button-row">
          <button type="button" className="btn btn--sm" onClick={() => rotate(-90)} aria-label="Nach links drehen" title="Nach links drehen">
            <RotateCcw size={16} />
          </button>
          <button type="button" className="btn btn--sm" onClick={() => rotate(90)} aria-label="Nach rechts drehen" title="Nach rechts drehen">
            <RotateCw size={16} />
          </button>
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
        </div>
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
        <Slider
          label="Entrauschen"
          value={settings.denoise}
          min={0}
          max={3}
          step={1}
          format={(v) => DENOISE_LABELS[v] ?? String(v)}
          onChange={(v) => set("denoise", v)}
        />
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
