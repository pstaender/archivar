import { Loader } from "../icons";
import { useEffect, useId, useState } from "react";
import { languageName, OCR_LANGUAGES } from "../../shared/languages";
import type { ArchiveDocument, LibraryItem } from "../../shared/types";
import { api } from "../api";
import { saveEditSettings, whenEditsSaved } from "../editSaves";
import { useConfig } from "../hooks/config";
import { usePresets } from "../hooks/presets";
import { useToast } from "../hooks/toast";
import { Dialog } from "./Dialog";
import { Switch } from "./Switch";

interface BatchDialogProps {
  open: boolean;
  items: LibraryItem[];
  onClose: () => void;
  /** Called after processing, also when some documents failed. */
  onDone: () => void;
}

export interface BatchOptions {
  presetId: number | null;
  ocr: boolean;
  /** Empty: the default languages. */
  language: string;
  allText: boolean;
}

const DEFAULT_OPTIONS: BatchOptions = { presetId: null, ocr: true, language: "", allText: false };

async function documentsOf(items: LibraryItem[]): Promise<ArchiveDocument[]> {
  const docs: ArchiveDocument[] = [];
  for (const item of items) {
    if (item.type === "document") docs.push(item.document);
    else docs.push(...(await api.stack(item.stack.id)).documents);
  }
  return docs;
}

/** Applies the preset (images only) and then queues OCR (images and PDFs), one document after another. */
async function processDocument(doc: ArchiveDocument, options: BatchOptions): Promise<void> {
  if (options.presetId !== null && doc.kind === "image") {
    await whenEditsSaved(doc.id);
    const { editSettings } = await api.applyPreset(doc.id, options.presetId);
    await saveEditSettings(doc.id, editSettings);
  }
  if (options.ocr && doc.kind !== "file") {
    await api.runOcr(doc.id, { allText: options.allText, languages: options.language ? [options.language] : null });
  }
}

export function BatchDialog({ open, items, onClose, onDone }: BatchDialogProps) {
  const toast = useToast();
  const config = useConfig();
  const { presets } = usePresets();
  const presetId = useId();
  const languageId = useId();
  const [options, setOptions] = useState<BatchOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    if (open) setOptions(DEFAULT_OPTIONS);
  }, [open]);

  const set = <K extends keyof BatchOptions>(key: K, value: BatchOptions[K]) => setOptions((current) => ({ ...current, [key]: value }));
  const working = progress !== null;
  const canRun = !working && (options.presetId !== null || options.ocr);
  const defaultLanguages = config.ocrLanguages.map(languageName).join(" + ");

  const run = async () => {
    setProgress({ done: 0, total: 0 });
    const failures: unknown[] = [];
    let total = 0;
    try {
      const docs = await documentsOf(items);
      total = docs.length;
      setProgress({ done: 0, total });
      for (const [index, doc] of docs.entries()) {
        try {
          await processDocument(doc, options);
        } catch (error) {
          failures.push(error);
        }
        setProgress({ done: index + 1, total });
      }
    } catch (error) {
      failures.push(error);
    }
    setProgress(null);
    if (failures.length === 0) toast.success(total === 1 ? "1 Dokument verarbeitet" : `${total} Dokumente verarbeitet`);
    else {
      const reason = failures[0] instanceof Error ? failures[0].message : String(failures[0]);
      toast.error(new Error(`${failures.length} von ${total || items.length} konnten nicht verarbeitet werden: ${reason}`));
    }
    onDone();
    onClose();
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
        {progress && (
          <p className="muted small" role="status">
            <Loader size={14} className="spin" />{" "}
            {progress.total ? `${progress.done} von ${progress.total} verarbeitet …` : "Dokumente werden geladen …"}
          </p>
        )}
      </div>
    </Dialog>
  );
}
