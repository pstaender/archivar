import { Loader } from "../icons";
import { Dialog } from "./Dialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}

export function UnsavedChangesDialog({ open, saving, onSave, onDiscard, onStay }: UnsavedChangesDialogProps) {
  return (
    <Dialog
      open={open}
      title="Bearbeitung nicht gespeichert"
      onClose={onStay}
      footer={
        <>
          <button type="button" className="btn" onClick={onStay} disabled={saving}>
            Abbrechen
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onDiscard} disabled={saving}>
            Verwerfen
          </button>
          <button type="button" className="btn btn--primary" onClick={onSave} disabled={saving}>
            {saving && <Loader size={16} className="spin" />}
            Speichern
          </button>
        </>
      }
    >
      <p>Die Änderungen an diesem Bild sind noch nicht gespeichert.</p>
    </Dialog>
  );
}
