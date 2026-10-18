import { Loader } from "../icons";
import { useEffect, useId, useState } from "react";
import { OCR_LANGUAGES } from "../../shared/languages";
import { UI_LANGUAGES } from "../../shared/i18n";
import { describePreset } from "../../shared/presets";
import { DEFAULT_USER_SETTINGS, type PdfImageQuality, type UserSettings } from "../../shared/settings";
import { PDF_QUALITY_CHOICES } from "./PdfButton";
import { useAuth } from "../hooks/auth";
import { useConfig } from "../hooks/config";
import { usePresets } from "../hooks/presets";
import { useSettings } from "../hooks/settings";
import { useToast } from "../hooks/toast";
import { AccessSettings } from "./AccessSettings";
import { ApiTokens } from "./ApiTokens";
import { ArchiveExport } from "./ArchiveExport";
import { Dialog } from "./Dialog";
import { FolderPicker } from "./FolderPicker";
import { Switch } from "./Switch";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { ocrLanguageName } from "../format";

type Tab = "sizes" | "import" | "language" | "api" | "access" | "export";

const TABS: Tab[] = ["sizes", "import", "language", "api", "access", "export"];

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

function pdfQualities(t: TFunction): Choice<PdfImageQuality>[] {
  return PDF_QUALITY_CHOICES.map((value) => {
    const description = t(`pdf.qualityHints.${value}`);
    return { value, label: t(`pdf.qualities.${value}`), description: value === "medium" ? t("settings.mediumPageSize", { description }) : description };
  });
}

function ChoiceGroup<T extends string>({ legend, name, choices, value, disabled, onChange }: {
  legend: string;
  name: "pdfImageQuality";
  choices: Choice<T>[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset className="choice-group" disabled={disabled}>
      <legend>{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="choice">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            disabled={disabled}
            onChange={() => onChange(choice.value)}
          />
          <span className="choice__text">
            <span className="choice__label">
              {choice.label}
              {choice.value === DEFAULT_USER_SETTINGS[name] && <span className="choice__default">{t("pdf.default")}</span>}
            </span>
            <span className="choice__description">{choice.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { t, i18n } = useTranslation();
  const { settings: stored, loaded, save } = useSettings();
  const { presets } = usePresets();
  const { ocrLanguages: defaultLanguages } = useConfig();
  // The export holds the data of all users, so it is only offered to an admin who has to log in.
  const { passwordSet, user } = useAuth().status;
  const canExport = passwordSet && user?.admin === true;
  const tabs = canExport ? TABS : TABS.filter((value) => value !== "export");
  const presetSelectId = useId();
  const languageSelectId = useId();
  const uiLanguageSelectId = useId();
  const [tab, setTab] = useState<Tab>("sizes");
  const [draft, setDraft] = useState<UserSettings>(stored);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(stored);
  }, [open, stored]);

  useEffect(() => {
    if (!canExport && tab === "export") setTab("access");
  }, [canExport, tab]);

  const set = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await save(draft);
      toast.success(t("settings.saved"));
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };

  const importPreset = presets.find((preset) => preset.id === draft.importPresetId);

  return (
    <Dialog
      open={open}
      title={t("settings.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!loaded || saving}>
            {saving && <Loader size={16} className="spin" />}
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="tabs tabs--dialog" role="tablist">
        {tabs.map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
            {t(`settings.tabs.${value}`)}
          </button>
        ))}
      </div>
      {!loaded ? (
        <p className="muted small">
          <Loader size={16} className="spin" /> {t("settings.loading")}
        </p>
      ) : (
        <div className="settings" role="tabpanel">
          {tab === "sizes" && (
            <ChoiceGroup
              legend={t("settings.pdfQualityLegend")}
              name="pdfImageQuality"
              choices={pdfQualities(t)}
              value={draft.pdfImageQuality}
              onChange={(value) => set("pdfImageQuality", value)}
            />
          )}
          {tab === "import" && (
            <>
              <Switch checked={draft.autoOcr} onChange={(value) => set("autoOcr", value)} hint={t("settings.autoOcrHint")}>
                {t("settings.autoOcr")}
              </Switch>
              <Switch checked={draft.ocrAllText} onChange={(value) => set("ocrAllText", value)} hint={t("settings.allTextHint")}>
                {t("settings.allText")}
              </Switch>
              <div className="settings__field">
                <label htmlFor={languageSelectId} className="field__label">
                  {t("settings.ocrLanguage")}
                </label>
                <select
                  id={languageSelectId}
                  className="input"
                  value={draft.importOcrLanguages?.[0] ?? ""}
                  onChange={(e) => set("importOcrLanguages", e.target.value ? [e.target.value] : null)}
                >
                  <option value="">{t("settings.automatic")}</option>
                  {OCR_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {ocrLanguageName(code)}
                    </option>
                  ))}
                </select>
                <p className="muted small">
                  {draft.importOcrLanguages
                    ? t("settings.ocrLanguageFixed")
                    : t("settings.ocrLanguageAuto", { languages: defaultLanguages.map(ocrLanguageName).join(t("settings.and")) })}
                </p>
              </div>
              <div className="settings__field">
                <label htmlFor={presetSelectId} className="field__label">
                  {t("settings.applyPreset")}
                </label>
                <select
                  id={presetSelectId}
                  className="input"
                  value={draft.importPresetId ?? ""}
                  onChange={(e) => set("importPresetId", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">{t("settings.noPreset")}</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <p className="muted small">
                  {importPreset
                    ? describePreset(t, importPreset.steps)
                    : t("settings.presetHint")}
                </p>
              </div>
              <div className="settings__field">
                <FolderPicker label={t("settings.importFolders")} value={draft.importFolders} onChange={(folders) => set("importFolders", folders)} />
                <p className="muted small">{t("settings.importFoldersHint")}</p>
              </div>
            </>
          )}
          {tab === "language" && (
            <div className="settings__field">
              <label htmlFor={uiLanguageSelectId} className="field__label">
                {t("settings.uiLanguage")}
              </label>
              <select id={uiLanguageSelectId} className="input" value={i18n.resolvedLanguage} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
                {UI_LANGUAGES.map(({ code, name }) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="muted small">{t("settings.uiLanguageHint")}</p>
            </div>
          )}
          {tab === "api" && <ApiTokens />}
          {tab === "access" && <AccessSettings />}
          {tab === "export" && canExport && <ArchiveExport />}
        </div>
      )}
    </Dialog>
  );
}
