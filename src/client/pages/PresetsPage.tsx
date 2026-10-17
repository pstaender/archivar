import { Pencil, Trash } from "../icons";
import { useState } from "react";
import { describeStep, type ImagePreset, presetStepList } from "../../shared/presets";
import { api } from "../api";
import { usePresets } from "../hooks/presets";
import { useSettings } from "../hooks/settings";
import { useToast } from "../hooks/toast";
import { ConfirmDialog } from "../components/Dialog";
import { PresetDialog } from "../components/PresetDialog";

/** The saved image presets, to edit and delete them. */
export function PresetsPage() {
  const { presets, reload } = usePresets();
  const { settings, save: saveSettings } = useSettings();
  const toast = useToast();
  const [editing, setEditing] = useState<ImagePreset | null>(null);
  const [deleting, setDeleting] = useState<ImagePreset | null>(null);

  const update = async (name: string, steps: ImagePreset["steps"]) => {
    try {
      await api.updatePreset(editing!.id, { name, steps });
      await reload();
      toast.success("Bildeinstellung gespeichert");
    } catch (error) {
      toast.error(error);
      throw error;
    }
  };

  const remove = async (preset: ImagePreset) => {
    try {
      await api.deletePreset(preset.id);
      // The server turns the import preset off too; this keeps the loaded settings in step.
      if (settings.importPresetId === preset.id) await saveSettings({ importPresetId: null });
      await reload();
      toast.success(`„${preset.name}“ gelöscht`);
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Bildeinstellungen</h1>
          <p className="muted small">
            Gespeicherte Bearbeitungsschritte für Bilder: im Tab „Bearbeiten“ anwenden, beim Import (Einstellungen → Import) und in der Stapelverarbeitung.
          </p>
        </div>
      </header>

      {presets.length === 0 && (
        <div className="empty-state">
          <p className="muted">Noch keine Bildeinstellungen. Speichere die Bearbeitung eines Bildes im Tab „Bearbeiten“ oder „Formen“ als Bildeinstellung.</p>
        </div>
      )}

      <ul className="presets" aria-label="Bildeinstellungen">
        {presets.map((preset) => (
          <li key={preset.id} className="preset-card">
            <div className="preset-card__header">
              <h2>
                {preset.name}
                {settings.importPresetId === preset.id && <span className="preset-card__badge">Beim Import</span>}
              </h2>
              <button type="button" className="btn btn--sm" onClick={() => setEditing(preset)} aria-label={`${preset.name} bearbeiten`}>
                <Pencil size={16} />
                Bearbeiten
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => setDeleting(preset)}
                aria-label={`${preset.name} löschen`}
                title="Löschen"
              >
                <Trash size={16} />
              </button>
            </div>
            <ul className="preset-card__steps" aria-label={`Schritte von ${preset.name}`}>
              {presetStepList(preset.steps).map((step) => (
                <li key={step} className="chip">
                  {describeStep(preset.steps, step)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <PresetDialog
        open={editing !== null}
        title="Bildeinstellung bearbeiten"
        initialName={editing?.name ?? ""}
        steps={editing?.steps ?? {}}
        editValues
        submitLabel="Speichern"
        onSubmit={update}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Bildeinstellung löschen"
        message={
          deleting && settings.importPresetId === deleting.id
            ? `„${deleting.name}“ löschen? Sie wird bei Imports angewendet – danach gilt dort wieder die Bildbearbeitung aus den Einstellungen.`
            : `„${deleting?.name}“ löschen? Bereits bearbeitete Bilder bleiben unverändert.`
        }
        confirmLabel="Löschen"
        danger
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
