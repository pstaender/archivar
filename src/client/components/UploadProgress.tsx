import { useUpload } from "../hooks/upload";
import { useTranslation } from "react-i18next";

export function UploadProgress() {
  const { progress } = useUpload();
  const { t } = useTranslation();
  if (!progress) return null;

  const current = Math.min(progress.done + 1, progress.total);
  const percent = Math.round(progress.fraction * 100);
  const label = progress.total === 1 ? t("upload.file") : t("upload.fileOf", { current, total: progress.total });

  return (
    <div className="upload-progress" role="status">
      <div className="upload-progress__label">
        <span>{progress.processing ? t("upload.processing", { label }) : t("upload.uploading", { label })}</span>
        <span className="upload-progress__percent">{percent} %</span>
      </div>
      <div className="upload-progress__track" role="progressbar" aria-label={t("upload.progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="upload-progress__bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
