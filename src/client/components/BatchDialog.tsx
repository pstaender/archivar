import { Loader } from "../icons";
import { useEffect, useId, useState } from "react";
import { languageName, OCR_LANGUAGES } from "../../shared/languages";
import { api } from "../api";
import { whenEditsSaved } from "../editSaves";
import { useConfig } from "../hooks/config";
import { useJobs } from "../hooks/jobs";
import { usePresets } from "../hooks/presets";
import { useToast } from "../hooks/toast";
import { Dialog } from "./Dialog";
import { Switch } from "./Switch";

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
}

const DEFAULT_CHOICE: BatchChoice = { presetId: null, ocr: true, language: "", allText: false };

export function BatchDialog({ open, documentIds, onClose, onStarted }: BatchDialogProps) {
  const toast = useToast();
  const config = useConfig();
  const { presets } = usePresets();
  const { reload: reloadJobs } = useJobs();
  const presetId = useId();
  const languageId = useId();
  const [options, setOptions] = useState<BatchChoice>(DEFAULT_CHOICE);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) setOptions(DEFAULT_CHOICE);
  }, [open]);

  const set = <K extends keyof BatchChoice>(key: K, value: BatchChoice[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const canRun = !working && (options.presetId !== null || options.ocr);
  const defaultLanguages = config.ocrLanguages.map(languageName).join(" + ");

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
      });
      void reloadJobs();
      toast.success(`Stapelverarbeitung für ${documentIds.length === 1 ? "1 Dokument" : `${documentIds.length} Dokumente`} gestartet`);
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
      title="Stapelverarbeitung"
      onClose={() => !working && onClose()}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={working}>
            Abbrechen
          </button>
          <button type="button" className="btn btn--primary" onClick={run} disabled={!canRun}>
            {working && <Loader size={16} className="spin" />}
            Anwenden
          </button>
        </>
      }
    >
      <div className="settings settings--compact">
        <div className="settings__field">
          <label htmlFor={presetId} className="field__label">
            Bildeinstellung
          </label>
          <select
            id={presetId}
            className="input"
            value={options.presetId ?? ""}
            disabled={working}
            onChange={(e) => set("presetId", e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Keine – Bilder bleiben unverändert</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <p className="muted small">Gilt nur für Bilder, angewendet auf ihre bisherige Bearbeitung.</p>
        </div>
        <Switch checked={options.ocr} disabled={working} onChange={(value) => set("ocr", value)} hint="Erkennt den Text der Bilder und PDFs neu.">
          Text erkennen
        </Switch>
        <div className="settings__field">
          <label htmlFor={languageId} className="field__label">
            Sprache
          </label>
          <select id={languageId} className="input" value={options.language} disabled={working || !options.ocr} onChange={(e) => set("language", e.target.value)}>
            <option value="">Automatisch ({defaultLanguages})</option>
            {OCR_LANGUAGES.map(({ code, name }) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <Switch
          checked={options.allText}
          disabled={working || !options.ocr}
          onChange={(value) => set("allText", value)}
          hint="Übernimmt auch unsichere, vermutlich fehlerhafte Textteile."
        >
          Alle Textteile erkennen
        </Switch>
        <p className="muted small">Läuft im Hintergrund weiter; den Fortschritt zeigt „Stapelverarbeitung“ in der Seitenleiste.</p>
      </div>
    </Dialog>
  );
}
