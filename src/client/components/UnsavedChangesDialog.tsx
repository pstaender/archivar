import { Dialog } from "./Dialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onStay: () => void;
}

export function UnsavedChangesDialog({ open, onSave, onDiscard, onStay }: UnsavedChangesDialogProps) {
  return (
    <Dialog
      open={open}
      title="Bearbeitung nicht gespeichert"
      onClose={onStay}
      footer={
        <>
          <button type="button" className="btn" onClick={onStay}>
            Abbrechen
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onDiscard}>
            Verwerfen
          </button>
          <button type="button" className="btn btn--primary" onClick={onSave}>
            Speichern
          </button>
        </>
      }
    >
      <p>Die Änderungen an diesem Bild sind noch nicht gespeichert.</p>
    </Dialog>
  );
}
