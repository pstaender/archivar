import { Pencil, Trash } from "../icons";
import { useState } from "react";
import { describePreset, type ImagePreset } from "../../shared/presets";
import { api } from "../api";
import { usePresets } from "../hooks/presets";
import { useSettings } from "../hooks/settings";
import { useToast } from "../hooks/toast";
import { ConfirmDialog } from "./Dialog";
import { PresetDialog } from "./PresetDialog";

export function PresetList() {
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
    <section className="preset-list" aria-label="Bildeinstellungen">
      <div className="folder-tree__heading">
        <h3>Bildeinstellungen</h3>
      </div>
      {presets.length === 0 && <p className="folder-tree__empty">Im Tab „Bearbeiten“ speichern</p>}
      <ul className="preset-list__items">
        {presets.map((preset) => (
          <li key={preset.id} className="preset-list__item">
            <div className="preset-list__text">
              <span className="preset-list__name">{preset.name}</span>
              <span className="preset-list__summary">{describePreset(preset.steps)}</span>
            </div>
            <div className="preset-list__actions">
              <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setEditing(preset)} aria-label={`${preset.name} bearbeiten`} title="Bearbeiten">
                <Pencil size={14} />
              </button>
              <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setDeleting(preset)} aria-label={`${preset.name} löschen`} title="Löschen">
                <Trash size={14} />
              </button>
            </div>
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
    </section>
  );
}
