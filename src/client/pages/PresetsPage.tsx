import { Pencil, Trash } from "../icons";
import { useState } from "react";
import { describeStep, type ImagePreset, presetStepList } from "../../shared/presets";
import { api } from "../api";
import { usePresets } from "../hooks/presets";
import { useSettings } from "../hooks/settings";
import { useToast } from "../hooks/toast";
import { ConfirmDialog } from "../components/Dialog";
import { PresetDialog } from "../components/PresetDialog";
import { useTranslation } from "react-i18next";

/** The saved image presets, to edit and delete them. */
export function PresetsPage() {
  const { presets, reload } = usePresets();
  const { t } = useTranslation();
  const { settings, save: saveSettings } = useSettings();
  const toast = useToast();
  const [editing, setEditing] = useState<ImagePreset | null>(null);
  const [deleting, setDeleting] = useState<ImagePreset | null>(null);

  const update = async (name: string, steps: ImagePreset["steps"]) => {
    try {
      await api.updatePreset(editing!.id, { name, steps });
      await reload();
      toast.success(t("presets.saved"));
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
      toast.success(t("presets.deleted", { name: preset.name }));
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{t("presets.title")}</h1>
          <p className="muted small">
            {t("presets.intro")}
          </p>
        </div>
      </header>

      {presets.length === 0 && (
        <div className="empty-state">
          <p className="muted">{t("presets.empty")}</p>
        </div>
      )}

      <ul className="presets" aria-label={t("presets.title")}>
        {presets.map((preset) => (
          <li key={preset.id} className="preset-card">
            <div className="preset-card__header">
              <h2>
                {preset.name}
                {settings.importPresetId === preset.id && <span className="preset-card__badge">{t("presets.onImport")}</span>}
              </h2>
              <button type="button" className="btn btn--sm" onClick={() => setEditing(preset)} aria-label={t("presets.editLabel", { name: preset.name })}>
                <Pencil size={16} />
                {t("presets.edit")}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => setDeleting(preset)}
                aria-label={t("presets.deleteLabel", { name: preset.name })}
                title={t("common.delete")}
              >
                <Trash size={16} />
              </button>
            </div>
            <ul className="preset-card__steps" aria-label={t("presets.steps", { name: preset.name })}>
              {presetStepList(preset.steps).map((step) => (
                <li key={step} className="chip">
                  {describeStep(t, preset.steps, step)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <PresetDialog
        open={editing !== null}
        title={t("presets.editTitle")}
        initialName={editing?.name ?? ""}
        steps={editing?.steps ?? {}}
        editValues
        submitLabel={t("common.save")}
        onSubmit={update}
        onClose={() => setEditing(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={t("presets.deleteTitle")}
        message={
          deleting && settings.importPresetId === deleting.id
            ? t("presets.deleteImportPreset", { name: deleting.name })
            : t("presets.deleteConfirm", { name: deleting?.name })
        }
        confirmLabel={t("common.delete")}
        danger
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
