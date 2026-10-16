import { useUpload } from "../hooks/upload";

export function UploadProgress() {
  const { progress } = useUpload();
  if (!progress) return null;

  const current = Math.min(progress.done + 1, progress.total);
  const percent = Math.round(progress.fraction * 100);
  const label = progress.total === 1 ? "Datei" : `Datei ${current} von ${progress.total}`;

  return (
    <div className="upload-progress" role="status">
      <div className="upload-progress__label">
        <span>{progress.processing ? `Verarbeite ${label} …` : `Lade ${label} hoch …`}</span>
        <span className="upload-progress__percent">{percent} %</span>
      </div>
      <div className="upload-progress__track" role="progressbar" aria-label="Upload-Fortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="upload-progress__bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
