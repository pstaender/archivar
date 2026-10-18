import { AutoCrop, AutoRotate, Contrast, Crop, Eraser, Loader, RotateCcw, RotateCw, Scan, WandSparkles } from "../icons";
import { type CSSProperties, useEffect, useId } from "react";
import {
  GRAY_MIX_CHANNELS,
  GRAY_MIX_MAX,
  GRAY_MIX_MIN,
  GRAY_MIX_PRESETS,
  grayMixPresetId,
  LUMA_GRAY_MIX,
} from "../../shared/image/grayMix";
import { DENOISE_LEVELS, formatPercent as percent, formatSigned as signed } from "../../shared/presets";
import type { ColorMode, EditSettings } from "../../shared/types";
import { boundingRect, type GeometryMode, rotateSettings } from "./geometry";
import { useTranslation } from "react-i18next";

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

const COLOR_MODES: ColorMode[] = ["color", "grayscale", "bw"];

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
  const { t } = useTranslation();
  const set = <K extends keyof EditSettings>(key: K, value: EditSettings[K]) => onChange({ ...settings, [key]: value });

  useEffect(() => {
    if (mode === "none") return;
    const apply = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.defaultPrevented || isTextField(event.target)) return;
      // Also keeps a focused button (e.g. „Auto-Zuschnitt“) from being clicked again.
      event.preventDefault();
      onModeChange("none");
    };
    window.addEventListener("keydown", apply);
    return () => window.removeEventListener("keydown", apply);
  }, [mode, onModeChange]);

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
          <h3>{t("editControls.orientation")}</h3>
          <div className="button-row">
            <button type="button" className="btn btn--sm btn--icon" onClick={() => rotate(-90)} aria-label={t("editControls.rotateLeft")} title={t("editControls.rotateLeft")}>
              <RotateCcw size={16} />
            </button>
            <button type="button" className="btn btn--sm btn--icon" onClick={() => rotate(90)} aria-label={t("editControls.rotateRight")} title={t("editControls.rotateRight")}>
              <RotateCw size={16} />
            </button>
          </div>
        </div>
        <div className="tool-grid">
          <button type="button" className={`btn btn--sm ${mode === "crop" ? "is-active" : ""}`} aria-pressed={mode === "crop"} onClick={() => toggleMode("crop")}>
            <Crop size={16} />
            {t("editControls.crop")}
          </button>
          <button
            type="button"
            className={`btn btn--sm ${mode === "perspective" ? "is-active" : ""}`}
            aria-pressed={mode === "perspective"}
            onClick={() => toggleMode("perspective")}
          >
            <Scan size={16} />
            {t("editControls.perspective")}
          </button>
          {onAutoRotate && (
            <button type="button" className="btn btn--sm" onClick={onAutoRotate} disabled={rotating} title={t("editControls.autoRotateTitle")}>
              {rotating ? <Loader size={16} className="spin" /> : <AutoRotate size={16} />}
              {t("editControls.autoRotate")}
            </button>
          )}
          {onAutoCrop && (
            <button type="button" className="btn btn--sm" onClick={onAutoCrop} disabled={cropping} title={t("editControls.autoCropTitle")}>
              {cropping ? <Loader size={16} className="spin" /> : <AutoCrop size={16} />}
              {t("editControls.autoCrop")}
            </button>
          )}
        </div>
        {(rotating || cropping) && (
          <p className="muted small" aria-live="polite">
            {rotating ? t("editControls.detectingOrientation") : t("editControls.findingEdges")}
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
              {t("editControls.autoDewarp")}
            </button>
            <span className="muted small">
              {dewarping ? t("editControls.detectingPage") : settings.dewarp ? t("editControls.dewarped") : null}
            </span>
          </div>
        )}
        {mode !== "none" && (
          <p className="muted small">
            {mode === "crop"
              ? t("editControls.cropHint")
              : t("editControls.perspectiveHint")}
            {settings.corners && (
              <>
                {" "}
                <button type="button" className="link-button" onClick={() => set("corners", null)}>
                  {t("editControls.reset")}
                </button>
              </>
            )}
          </p>
        )}
        {mode === "none" && settings.corners && (
          <p className="muted small">
            {t("editControls.cropActive")}{" "}
            <button type="button" className="link-button" onClick={() => set("corners", null)}>
              {t("editControls.remove")}
            </button>
          </p>
        )}
      </section>

      <section className="control-group">
        <h3>{t("editControls.light")}</h3>
        <Slider label={t("editControls.brightness")} value={settings.brightness} min={-1} max={1} step={0.01} format={percent} onChange={(v) => set("brightness", v)} />
        <Slider label={t("editControls.contrast")} value={settings.contrast} min={-1} max={1} step={0.01} format={percent} onChange={(v) => set("contrast", v)} />
        <label className="switch">
          <input type="checkbox" checked={settings.autoLevels} onChange={(e) => set("autoLevels", e.target.checked)} />
          <span className="switch__track" aria-hidden />
          <span>{t("editControls.autoLevels")}</span>
        </label>
      </section>

      <section className="control-group">
        <h3>{t("editControls.color")}</h3>
        {onAutoBw && (
          <div className="dewarp-row">
            <button type="button" className={`btn btn--sm ${autoBw ? "is-active" : ""}`} aria-pressed={Boolean(autoBw)} onClick={onAutoBw} disabled={bwLoading}>
              {bwLoading ? <Loader size={16} className="spin" /> : <Contrast size={16} />}
              {t("editControls.autoBw")}
            </button>
            <span className="muted small" aria-live="polite">
              {bwLoading
                ? t("editControls.autoBwLoading")
                : autoBw
                  ? `${t("editControls.autoBwVariant", { index: autoBw.index + 1, count: autoBw.count, shade: t(`editControls.shades.${autoBw.shade}`) })}${autoBw.count > 1 ? t("editControls.autoBwNext") : "."}`
                  : t("editControls.autoBwHint")}
            </span>
          </div>
        )}
        <div className="segmented" role="radiogroup" aria-label={t("editControls.colorMode")}>
          {COLOR_MODES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={settings.colorMode === value}
              className={settings.colorMode === value ? "is-active" : ""}
              onClick={() => set("colorMode", value)}
            >
              {t(`colorModes.${value}`)}
            </button>
          ))}
        </div>
        {settings.colorMode === "color" && (
          <>
            <Slider label={t("editControls.saturation")} value={settings.saturation} min={-100} max={100} step={1} format={signed} onChange={(v) => set("saturation", v)} />
            <Slider label={t("editControls.hue")} value={settings.hue} min={-180} max={180} step={1} format={(v) => `${signed(v)}°`} onChange={(v) => set("hue", v)} />
          </>
        )}
        {settings.colorMode === "grayscale" && (
          <>
            <GrayMixControls value={settings.grayMix} onChange={(mix) => set("grayMix", mix)} />
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.grayThreshold !== null}
                onChange={(e) => set("grayThreshold", e.target.checked ? settings.bwThreshold : null)}
              />
              <span className="switch__track" aria-hidden />
              <span>{t("editControls.threshold")}</span>
            </label>
            {settings.grayThreshold !== null && (
              <Slider label={t("editControls.thresholdSlider")} value={settings.grayThreshold} min={0} max={255} step={1} defaultValue={128} onChange={(v) => set("grayThreshold", v)} />
            )}
          </>
        )}
        {settings.colorMode === "bw" && (
          <Slider label={t("editControls.thresholdSlider")} value={settings.bwThreshold} min={0} max={255} step={1} defaultValue={128} onChange={(v) => set("bwThreshold", v)} />
        )}
      </section>

      <section className="control-group">
        <h3>{t("editControls.noise")}</h3>
        <div className="dewarp-row">
          <button
            type="button"
            className={`btn btn--sm ${settings.denoise > 0 ? "is-active" : ""}`}
            aria-pressed={settings.denoise > 0}
            onClick={() => set("denoise", (settings.denoise + 1) % DENOISE_LEVELS.length)}
          >
            <Eraser size={16} />
            {t("editControls.denoise")}
          </button>
          <span className="muted small" aria-live="polite">
            {settings.denoise > 0
              ? t("editControls.denoiseStrength", {
                  level: t(`denoise.${DENOISE_LEVELS[settings.denoise]}`),
                  next: settings.denoise < DENOISE_LEVELS.length - 1 ? t("editControls.denoiseStronger") : t("editControls.denoiseOff"),
                })
              : t("editControls.denoiseHint")}
          </span>
        </div>
      </section>
    </div>
  );
}

const CUSTOM = "custom";

/** Sliders per hue like Photoshop's „Schwarzweiß“; they start at the weights of the plain conversion (stored as null). */
function GrayMixControls({ value, onChange }: { value: EditSettings["grayMix"]; onChange: (mix: EditSettings["grayMix"]) => void }) {
  const id = useId();
  const { t } = useTranslation();
  const presetId = grayMixPresetId(value) ?? CUSTOM;
  const mix = value ?? LUMA_GRAY_MIX;
  const choose = (next: string) => {
    if (next === "luma") return onChange(null);
    const preset = GRAY_MIX_PRESETS.find((p) => p.id === next);
    if (preset) onChange(preset.mix);
  };
  return (
    <>
      <div className="slider">
        <label htmlFor={id} className="slider__header">
          {t("editControls.channels")}
        </label>
        <select id={id} className="input input--sm" value={presetId} onChange={(e) => choose(e.target.value)}>
          <option value="luma">{t("grayMix.presets.luma")}</option>
          {GRAY_MIX_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(`grayMix.presets.${preset.id}`)}
            </option>
          ))}
          {presetId === CUSTOM && <option value={CUSTOM}>{t("editControls.customValues")}</option>}
        </select>
      </div>
      {GRAY_MIX_CHANNELS.map(({ key }) => (
        <Slider
          key={key}
          label={t(`grayMix.channels.${key}`)}
          value={mix[key]}
          min={GRAY_MIX_MIN}
          max={GRAY_MIX_MAX}
          step={1}
          defaultValue={LUMA_GRAY_MIX[key]}
          format={(v) => `${v} %`}
          onChange={(v) => {
            const next = { ...mix, [key]: v };
            onChange(grayMixPresetId(next) === "luma" ? null : next);
          }}
        />
      ))}
      <div className="button-row">
        <button type="button" className="btn btn--sm" onClick={() => onChange(null)} disabled={presetId === "luma"}>
          <RotateCcw size={16} />
          {t("editControls.resetAll")}
        </button>
      </div>
    </>
  );
}

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

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["range", "checkbox", "radio", "button"].includes(target.type);
}
