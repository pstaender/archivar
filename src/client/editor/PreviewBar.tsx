import { Eye, Loader } from "../icons";
import { useTranslation } from "react-i18next";

interface PreviewBarProps {
  processing: boolean;
  showing: boolean;
  onPreview: () => void;
  onLive: () => void;
}

export function PreviewBar({ processing, showing, onPreview, onLive }: PreviewBarProps) {
  const { t } = useTranslation();
  return (
    <div className="zoom-bar preview-bar" role="toolbar" aria-label={t("preview.label")}>
      {showing ? (
        <>
          <span className="preview-bar__hint">{t("preview.finalHint")}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onLive}>
            {t("preview.live")}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPreview} disabled={processing} aria-busy={processing}>
          {processing ? <Loader size={16} className="spin" /> : <Eye size={16} />}
          {processing ? t("preview.rendering") : t("preview.show")}
        </button>
      )}
    </div>
  );
}
