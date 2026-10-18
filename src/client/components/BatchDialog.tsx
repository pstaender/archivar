import { Loader } from "../icons";
import { useEffect, useId, useState } from "react";
import { OCR_LANGUAGES } from "../../shared/languages";
import { ocrLanguageName } from "../format";
import { applyNameScheme } from "../../shared/nameScheme";
import { api } from "../api";
import { whenEditsSaved } from "../editSaves";
import { useConfig } from "../hooks/config";
import { useJobs } from "../hooks/jobs";
import { usePresets } from "../hooks/presets";
import { useToast } from "../hooks/toast";
import { Dialog } from "./Dialog";
import { Switch } from "./Switch";
import { useTranslation } from "react-i18next";

interface BatchDialogProps {
  open: boolean;
  documentIds: number[];
  onClose: () => void;
  /** Called once the job is started. */
  onStarted: () => void;
}

interface BatchChoice {
  presetId: number | null;
  ocr: boolean;
  /** Empty: the default languages. */
  language: string;
  allText: boolean;
  /** Empty: the names stay. */
  rename: string;
}

const DEFAULT_CHOICE: BatchChoice = { presetId: null, ocr: true, language: "", allText: false, rename: "" };

export function BatchDialog({ open, documentIds, onClose, onStarted }: BatchDialogProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const config = useConfig();
  const { presets } = usePresets();
  const { reload: reloadJobs } = useJobs();
  const presetId = useId();
  const languageId = useId();
  const renameId = useId();
  const [options, setOptions] = useState<BatchChoice>(DEFAULT_CHOICE);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) setOptions(DEFAULT_CHOICE);
  }, [open]);

  const set = <K extends keyof BatchChoice>(key: K, value: BatchChoice[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const rename = options.rename.trim();
  const canRun = !working && (options.presetId !== null || options.ocr || rename !== "");
  const defaultLanguages = config.ocrLanguages.map(ocrLanguageName).join(" + ");

  const run = async () => {
    setWorking(true);
    try {
      await whenEditsSaved();
      await api.createJob({
        kind: "batch",
        documentIds,
        presetId: options.presetId,
        ocr: options.ocr,
        languages: options.language ? [options.language] : null,
        allText: options.allText,
        rename: rename || null,
      });
      void reloadJobs();
      toast.success(t("batch.started", { count: documentIds.length }));
      onStarted();
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={t("batch.title")}
      onClose={() => !working && onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={working}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={!canRun}>
            {working && <Loader size={16} className="spin" />}
            {t("common.apply")}
          </button>
        </>
      }
    >
      <div className="settings settings--compact">
        <div className="settings__field">
          <label htmlFor={presetId} className="field__label">
            {t("batch.preset")}
          </label>
          <select
            id={presetId}
            className="input"
            value={options.presetId ?? ""}
            disabled={working}
            onChange={(e) => set("presetId", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t("settings.noPreset")}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <p className="muted small">{t("batch.presetHint")}</p>
        </div>
        <div className="settings__field">
          <label htmlFor={renameId} className="field__label">
            {t("batch.rename")}
          </label>
          <input
            id={renameId}
            className="input"
            value={options.rename}
            disabled={working}
            placeholder={t("batch.renamePlaceholder")}
            onChange={(e) => set("rename", e.target.value)}
          />
          <p className="muted small">
            {rename
              ? documentIds.length > 1
                ? t("batch.renamePreviewRange", {
                    first: applyNameScheme(rename, 1, documentIds.length),
                    last: applyNameScheme(rename, documentIds.length, documentIds.length),
                  })
                : t("batch.renamePreview", { first: applyNameScheme(rename, 1, documentIds.length) })
              : t("batch.renameHint")}
          </p>
        </div>
        <Switch checked={options.ocr} disabled={working} onChange={(value) => set("ocr", value)} hint={t("batch.ocrHint")}>
          {t("batch.ocr")}
        </Switch>
        <div className="settings__field">
          <label htmlFor={languageId} className="field__label">
            {t("batch.language")}
          </label>
          <select id={languageId} className="input" value={options.language} disabled={working || !options.ocr} onChange={(e) => set("language", e.target.value)}>
            <option value="">{t("batch.automaticLanguages", { languages: defaultLanguages })}</option>
            {OCR_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {ocrLanguageName(code)}
              </option>
            ))}
          </select>
        </div>
        <Switch
          checked={options.allText}
          disabled={working || !options.ocr}
          onChange={(value) => set("allText", value)}
          hint={t("settings.allTextHint")}
        >
          {t("settings.allText")}
        </Switch>
        <p className="muted small">{t("batch.background")}</p>
      </div>
    </Dialog>
  );
}
