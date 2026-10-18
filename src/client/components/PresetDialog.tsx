import { Loader } from "../icons";
import { type FormEvent, useEffect, useId, useState } from "react";
import {
  DENOISE_LEVELS,
  describeStep,
  formatPercent,
  formatSigned,
  type PresetStep,
  type PresetSteps,
  pickSteps,
  presetStepList,
} from "../../shared/presets";
import { GRAY_MIX_PRESETS, grayMixPresetId } from "../../shared/image/grayMix";
import type { ColorMode, Rotation } from "../../shared/types";
import { Slider } from "../editor/EditControls";
import { Dialog } from "./Dialog";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

interface PresetDialogProps {
  open: boolean;
  title: string;
  initialName: string;
  /** The steps offered; all start chosen. */
  steps: PresetSteps;
  /** Lets fixed values be changed, not only chosen. */
  editValues?: boolean;
  submitLabel: string;
  onSubmit: (name: string, steps: PresetSteps) => Promise<unknown>;
  onClose: () => void;
}

const sliders = (t: TFunction): Partial<Record<PresetStep, { min: number; max: number; step: number; defaultValue?: number; format?: (v: number) => string }>> => ({
  brightness: { min: -1, max: 1, step: 0.01, format: formatPercent },
  contrast: { min: -1, max: 1, step: 0.01, format: formatPercent },
  saturation: { min: -100, max: 100, step: 1, format: formatSigned },
  hue: { min: -180, max: 180, step: 1, format: (v) => `${formatSigned(v)}°` },
  grayThreshold: { min: 0, max: 255, step: 1, defaultValue: 128 },
  bwThreshold: { min: 0, max: 255, step: 1, defaultValue: 128 },
  denoise: { min: 0, max: 3, step: 1, format: (v) => (DENOISE_LEVELS[v] ? t(`denoise.${DENOISE_LEVELS[v]}`) : String(v)) },
});

const SLIDER_LABELS: Partial<Record<PresetStep, string>> = {
  brightness: "presetDialog.brightness",
  contrast: "presetDialog.contrast",
  saturation: "presetDialog.saturation",
  hue: "presetDialog.hue",
  grayThreshold: "presetDialog.threshold",
  bwThreshold: "presetDialog.threshold",
  denoise: "presetDialog.denoise",
};

export function PresetDialog({ open, title, initialName, steps, editValues, submitLabel, onSubmit, onClose }: PresetDialogProps) {
  const nameId = useId();
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [values, setValues] = useState<PresetSteps>(steps);
  const [chosen, setChosen] = useState<PresetStep[]>(presetStepList(steps));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setValues(steps);
    setChosen(presetStepList(steps));
  }, [open]);

  const offered = presetStepList(values);
  const canSubmit = name.trim() !== "" && chosen.length > 0 && !saving;

  const toggle = (step: PresetStep, on: boolean) => setChosen((current) => (on ? [...current, step] : current.filter((s) => s !== step)));
  const setValue = <K extends PresetStep>(step: K, value: PresetSteps[K]) => setValues((current) => ({ ...current, [step]: value }));

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit(name.trim(), pickSteps(values, chosen));
      onClose();
    } catch {
      // The caller reports the error; the dialog stays open to try again.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => submit()} disabled={!canSubmit}>
            {saving && <Loader size={16} className="spin" />}
            {submitLabel}
          </button>
        </>
      }
    >
      <form className="preset-form" onSubmit={submit}>
        <div>
          <label htmlFor={nameId} className="field__label">
            {t("common.name")}
          </label>
          <input id={nameId} className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        </div>
        <fieldset className="preset-steps">
          <legend className="field__label">{t("presetDialog.settings")}</legend>
          {offered.length === 0 && <p className="muted small">{t("presetDialog.nothing")}</p>}
          {offered.map((step) => {
            const on = chosen.includes(step);
            const slider = sliders(t)[step];
            return (
              <div key={step} className="preset-step">
                <label className="preset-step__toggle">
                  <input type="checkbox" checked={on} onChange={(e) => toggle(step, e.target.checked)} />
                  <span>{describeStep(t, values, step)}</span>
                </label>
                {editValues && on && slider && (
                  <Slider
                    label={t(SLIDER_LABELS[step]!)}
                    value={values[step] as number}
                    {...slider}
                    onChange={(value) => setValue(step, value as never)}
                  />
                )}
                {editValues && on && step === "colorMode" && (
                  <select className="input input--sm" aria-label={t("presetDialog.colorMode")} value={values.colorMode} onChange={(e) => setValue("colorMode", e.target.value as ColorMode)}>
                    <option value="color">{t("colorModes.color")}</option>
                    <option value="grayscale">{t("colorModes.grayscale")}</option>
                    <option value="bw">{t("colorModes.bw")}</option>
                  </select>
                )}
                {editValues && on && step === "grayMix" && (
                  <select
                    className="input input--sm"
                    aria-label={t("presetDialog.grayMix")}
                    value={grayMixPresetId(values.grayMix ?? null) ?? "custom"}
                    onChange={(e) => {
                      const preset = GRAY_MIX_PRESETS.find((p) => p.id === e.target.value);
                      if (preset) setValue("grayMix", preset.mix);
                    }}
                  >
                    {GRAY_MIX_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {t(`grayMix.presets.${preset.id}`)}
                      </option>
                    ))}
                    {grayMixPresetId(values.grayMix ?? null) === null && <option value="custom">{t("presetDialog.customValues")}</option>}
                  </select>
                )}
                {on && step === "shapes" && (
                  <p className="muted small">{t("presetDialog.shapesHint")}</p>
                )}
                {editValues && on && step === "rotation" && (
                  <select className="input input--sm" aria-label={t("presetDialog.rotation")} value={values.rotation} onChange={(e) => setValue("rotation", Number(e.target.value) as Rotation)}>
                    {[0, 90, 180, 270].map((r) => (
                      <option key={r} value={r}>
                        {r}°
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </fieldset>
        <p className="muted small">{t("presetDialog.autoHint")}</p>
      </form>
    </Dialog>
  );
}
