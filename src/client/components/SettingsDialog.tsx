import { Loader } from "../icons";
import { useEffect, useId, useState } from "react";
import { languageName, OCR_LANGUAGES } from "../../shared/languages";
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

type Tab = "sizes" | "import" | "api" | "access" | "export";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "sizes", label: "Bildgrößen" },
  { tab: "import", label: "Import" },
  { tab: "api", label: "API" },
  { tab: "access", label: "Zugriff" },
  { tab: "export", label: "Export" },
];

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

const PDF_QUALITIES: Choice<PdfImageQuality>[] = PDF_QUALITY_CHOICES.map(({ value, label, description }) => ({
  value,
  label,
  description: value === "medium" ? `${description}. Eine Schwarzweiß-Seite hat etwa 150–200 KB.` : description,
}));

function ChoiceGroup<T extends string>({ legend, name, choices, value, disabled, onChange }: {
  legend: string;
  name: "pdfImageQuality";
  choices: Choice<T>[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
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
              {choice.value === DEFAULT_USER_SETTINGS[name] && <span className="choice__default">Standard</span>}
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
  const { settings: stored, loaded, save } = useSettings();
  const { presets } = usePresets();
  const { ocrLanguages: defaultLanguages } = useConfig();
  // The export holds the data of all users, so it is only offered to a user who has to log in.
  const { passwordSet } = useAuth().status;
  const tabs = passwordSet ? TABS : TABS.filter(({ tab }) => tab !== "export");
  const presetSelectId = useId();
  const languageSelectId = useId();
  const [tab, setTab] = useState<Tab>("sizes");
  const [draft, setDraft] = useState<UserSettings>(stored);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(stored);
  }, [open, stored]);

  useEffect(() => {
    if (!passwordSet && tab === "export") setTab("access");
  }, [passwordSet, tab]);

  const set = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await save(draft);
      toast.success("Einstellungen gespeichert");
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
      title="Einstellungen"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Abbrechen
          </button>
          <button type="button" className="btn btn--primary" onClick={submit} disabled={!loaded || saving}>
            {saving && <Loader size={16} className="spin" />}
            Speichern
          </button>
        </>
      }
    >
      <div className="tabs tabs--dialog" role="tablist">
        {tabs.map(({ tab: value, label }) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>
      {!loaded ? (
        <p className="muted small">
          <Loader size={16} className="spin" /> Einstellungen werden geladen …
        </p>
      ) : (
        <div className="settings" role="tabpanel">
          {tab === "sizes" && (
            <ChoiceGroup
              legend="Bildqualität im PDF-Export (Klick auf „PDF“; der Pfeil daneben bietet die anderen an)"
              name="pdfImageQuality"
              choices={PDF_QUALITIES}
              value={draft.pdfImageQuality}
              onChange={(value) => set("pdfImageQuality", value)}
            />
          )}
          {tab === "import" && (
            <>
              <Switch checked={draft.autoOcr} onChange={(value) => set("autoOcr", value)} hint="Erkennt den Text von Bildern und PDFs direkt beim Hochladen.">
                Text nach dem Upload erkennen
              </Switch>
              <Switch checked={draft.ocrAllText} onChange={(value) => set("ocrAllText", value)} hint="Übernimmt auch unsichere, vermutlich fehlerhafte Textteile.">
                Alle Textteile erkennen
              </Switch>
              <div className="settings__field">
                <label htmlFor={languageSelectId} className="field__label">
                  Sprache der Texterkennung
                </label>
                <select
                  id={languageSelectId}
                  className="input"
                  value={draft.importOcrLanguages?.[0] ?? ""}
                  onChange={(e) => set("importOcrLanguages", e.target.value ? [e.target.value] : null)}
                >
                  <option value="">Automatisch</option>
                  {OCR_LANGUAGES.map(({ code, name }) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="muted small">
                  {draft.importOcrLanguages
                    ? "Gilt für alle hochgeladenen Bilder und PDFs; einzelne Dokumente lassen sich im Tab „Text“ neu erkennen."
                    : `Erkennt zuerst mit ${defaultLanguages.map(languageName).join(" und ")}. Ist der Text in einer anderen Sprache, wird er in dieser Sprache neu erkannt.`}
                </p>
              </div>
              <div className="settings__field">
                <label htmlFor={presetSelectId} className="field__label">
                  Bildeinstellung anwenden
                </label>
                <select
                  id={presetSelectId}
                  className="input"
                  value={draft.importPresetId ?? ""}
                  onChange={(e) => set("importPresetId", e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Keine – Bilder bleiben unverändert</option>
                  {presets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                <p className="muted small">
                  {importPreset
                    ? describePreset(importPreset.steps)
                    : "Wird vor der Texterkennung auf jedes hochgeladene Bild angewendet. Bildeinstellungen werden im Tab „Bearbeiten“ eines Bildes gespeichert."}
                </p>
              </div>
              <div className="settings__field">
                <FolderPicker label="Zu Ordnern hinzufügen" value={draft.importFolders} onChange={(folders) => set("importFolders", folders)} />
                <p className="muted small">Jeder Upload kommt zusätzlich in diese Ordner.</p>
              </div>
            </>
          )}
          {tab === "api" && <ApiTokens />}
          {tab === "access" && <AccessSettings />}
          {tab === "export" && passwordSet && <ArchiveExport />}
        </div>
      )}
    </Dialog>
  );
}
