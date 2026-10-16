import { Loader } from "../icons";
import { type ReactNode, useEffect, useState } from "react";
import { DEFAULT_USER_SETTINGS, type PdfImageQuality, type UploadEnhancement, type UserSettings } from "../../shared/settings";
import { useConfig } from "../hooks/config";
import { useSettings } from "../hooks/settings";
import { useToast } from "../hooks/toast";
import { Dialog } from "./Dialog";

type Tab = "sizes" | "editing" | "ocr";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "sizes", label: "Bildgrößen" },
  { tab: "editing", label: "Bildbearbeitung" },
  { tab: "ocr", label: "OCR" },
];

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

const ENHANCEMENTS: Choice<UploadEnhancement>[] = [
  { value: "bw", label: "Schwarzweiß", description: "Dreht das Bild und wählt Helligkeit, Kontrast und Schwelle automatisch – am besten für Text." },
  { value: "grayscale", label: "Graustufen", description: "Dreht das Bild und wählt Helligkeit und Kontrast automatisch." },
  { value: "color", label: "Auto-Rotation", description: "Das Bild wird richtig gedreht." },
  { value: "original", label: "Original", description: "Lässt das Bild unverändert." },
];

const PDF_QUALITIES: Choice<PdfImageQuality>[] = [
  { value: "300", label: "300 DPI", description: "Für A4 verkleinert und komprimiert, gut zum Drucken. Eine Schwarzweiß-Seite hat etwa 150–200 KB." },
  { value: "150", label: "150 DPI", description: "Kleinere Dateien zum Lesen am Bildschirm oder für E-Mails." },
  { value: "original", label: "Original", description: "Bilder in voller Auflösung, die größten Dateien." },
];

function ChoiceGroup<T extends string>({ legend, name, choices, value, disabled, onChange }: {
  legend: string;
  name: "uploadEnhancement" | "pdfImageQuality";
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

function Switch({ checked, disabled, onChange, children, hint }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint: string;
}) {
  return (
    <label className="switch switch--described">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden />
      <span className="choice__text">
        <span className="choice__label">{children}</span>
        <span className="choice__description">{hint}</span>
      </span>
    </label>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const config = useConfig();
  const { settings: stored, loaded, save } = useSettings();
  const [tab, setTab] = useState<Tab>("sizes");
  const [draft, setDraft] = useState<UserSettings>(stored);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(stored);
  }, [open, stored]);

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

  const ocrOffHint = draft.autoOcr ? null : <p className="muted small">Gilt nur, wenn unter „OCR“ „Nach dem Upload erkennen“ eingeschaltet ist.</p>;

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
        {TABS.map(({ tab: value, label }) => (
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
              legend="Bildgröße im PDF-Export"
              name="pdfImageQuality"
              choices={PDF_QUALITIES}
              value={draft.pdfImageQuality}
              onChange={(value) => set("pdfImageQuality", value)}
            />
          )}
          {tab === "editing" && (
            <>
              <ChoiceGroup
                legend="Bildbearbeitung bei automatischer Texterkennung"
                name="uploadEnhancement"
                choices={ENHANCEMENTS}
                value={draft.uploadEnhancement}
                disabled={!draft.autoOcr}
                onChange={(value) => set("uploadEnhancement", value)}
              />
              {config.dewarpAvailable && (
                <Switch
                  checked={draft.autoDewarp}
                  disabled={!draft.autoOcr}
                  onChange={(value) => set("autoDewarp", value)}
                  hint="Glättet gewölbte Seiten in Fotos vor der Texterkennung."
                >
                  Automatisch entzerren
                </Switch>
              )}
              {ocrOffHint}
            </>
          )}
          {tab === "ocr" && (
            <>
              <Switch checked={draft.autoOcr} onChange={(value) => set("autoOcr", value)} hint="Erkennt den Text von Bildern und PDFs direkt beim Hochladen.">
                Nach dem Upload erkennen
              </Switch>
              <Switch checked={draft.ocrAllText} onChange={(value) => set("ocrAllText", value)} hint="Übernimmt auch unsichere, vermutlich fehlerhafte Textteile.">
                Alle Textteile erkennen
              </Switch>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}
