import { Dialog } from "./Dialog";
import { useTranslation } from "react-i18next";

interface UnsavedChangesDialogProps {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}

export function UnsavedChangesDialog({ open, onSave, onDiscard, onStay }: UnsavedChangesDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      title={t("unsaved.title")}
      onClose={onStay}
      footer={
        <>
          <button type="button" className="btn" onClick={onStay}>
            {t("common.cancel")}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onDiscard}>
            {t("unsaved.discard")}
          </button>
          <button type="button" className="btn btn--primary" onClick={onSave}>
            {t("common.save")}
          </button>
        </>
      }
    >
      <p>{t("unsaved.text")}</p>
    </Dialog>
  );
}
