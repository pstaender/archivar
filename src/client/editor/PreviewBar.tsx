import { Eye, Loader } from "../icons";

interface PreviewBarProps {
  processing: boolean;
  showing: boolean;
  onPreview: () => void;
  onLive: () => void;
}

export function PreviewBar({ processing, showing, onPreview, onLive }: PreviewBarProps) {
  return (
    <div className="zoom-bar preview-bar" role="toolbar" aria-label="Vorschau">
      {showing ? (
        <>
          <span className="preview-bar__hint">Endergebnis · Maus über das Bild für 100 %</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLive}>
            Live-Ansicht
          </button>
        </>
      ) : (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPreview} disabled={processing} aria-busy={processing}>
          {processing ? <Loader size={16} className="spin" /> : <Eye size={16} />}
          {processing ? "Vorschau wird berechnet …" : "Vorschau"}
        </button>
      )}
    </div>
  );
}
