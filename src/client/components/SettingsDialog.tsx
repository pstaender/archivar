import { Loader } from "../icons";
import { useEffect, useState } from "react";
import { DEFAULT_USER_SETTINGS, type PdfImageQuality, type UploadEnhancement, type UserSettings } from "../../shared/settings";
import { api } from "../api";
import { useToast } from "../hooks/toast";
import { Dialog } from "./Dialog";

interface Choice<T extends string> {
  value: T;
  label: string;
  description: string;
}

const ENHANCEMENTS: Choice<UploadEnhancement>[] = [
  { value: "bw", label: "Schwarzweiß", description: "Dreht das Bild und wählt Helligkeit, Kontrast und Schwelle automatisch – am besten für Text." },
  { value: "grayscale", label: "Graustufen", description: "Dreht das Bild und wählt Helligkeit und Kontrast automatisch." },
  { value: "color", label: "Farbe", description: "Dreht das Bild nur aufrecht." },
  { value: "original", label: "Original", description: "Lässt das Bild unverändert." },
];

const PDF_QUALITIES: Choice<PdfImageQuality>[] = [
  { value: "300", label: "300 DPI", description: "Für A4 verkleinert und komprimiert, gut zum Drucken. Eine Schwarzweiß-Seite hat etwa 150–200 KB." },
  { value: "150", label: "150 DPI", description: "Kleinere Dateien zum Lesen am Bildschirm oder für E-Mails." },
  { value: "original", label: "Original", description: "Bilder in voller Auflösung, die größten Dateien." },
];

function ChoiceGroup<T extends string>({ legend, name, choices, value, onChange }: {
  legend: string;
  name: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      {choices.map((choice) => (
        <label key={choice.value} className="choice">
          <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
          <span className="choice__text">
            <span className="choice__label">
              {choice.label}
              {choice.value === DEFAULT_USER_SETTINGS[name as keyof UserSettings] && <span className="choice__default">Standard</span>}
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
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSettings(null);
    api
      .settings()
      .then((loaded) => !cancelled && setSettings(loaded))
      .catch((error) => {
        if (cancelled) return;
        toast.error(error);
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await api.updateSettings(settings);
      toast.success("Einstellungen gespeichert");
      onClose();
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };

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
          <button type="button" className="btn btn--primary" onClick={save} disabled={!settings || saving}>
            {saving && <Loader size={16} className="spin" />}
            Speichern
          </button>
        </>
      }
    >
      {settings ? (
        <div className="settings">
          <ChoiceGroup
            legend="Bildbearbeitung bei automatischer Texterkennung"
            name="uploadEnhancement"
            choices={ENHANCEMENTS}
            value={settings.uploadEnhancement}
            onChange={(uploadEnhancement) => setSettings({ ...settings, uploadEnhancement })}
          />
          <ChoiceGroup
            legend="Bildgröße im PDF-Export"
            name="pdfImageQuality"
            choices={PDF_QUALITIES}
            value={settings.pdfImageQuality}
            onChange={(pdfImageQuality) => setSettings({ ...settings, pdfImageQuality })}
          />
        </div>
      ) : (
        <p className="muted small" aria-busy>
          <Loader size={16} className="spin" /> Einstellungen werden geladen …
        </p>
      )}
    </Dialog>
  );
}
