import { useState } from "react";
import { api } from "../api";
import { formatBytes } from "../format";
import { useToast } from "../hooks/toast";
import { Download, Loader } from "../icons";
import { Trans, useTranslation } from "react-i18next";

export const ARCHIVE_EXPORT_URL = "/api/export/archive";

/** Downloads the whole archive; a plain link, so the browser streams the zip to disk instead of holding it in memory. */
function startDownload(): void {
  const link = document.createElement("a");
  link.href = ARCHIVE_EXPORT_URL;
  link.download = "";
  document.body.append(link);
  link.click();
  link.remove();
}

export function ArchiveExport() {
  const toast = useToast();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState<number | null>(null);

  const ask = async () => {
    setLoading(true);
    try {
      setSize((await api.archiveExportSize()).bytes);
    } catch (error) {
      toast.error(error);
    } finally {
      setLoading(false);
    }
  };

  const download = () => {
    startDownload();
    setSize(null);
    toast.success(t("archiveExport.started"));
  };

  return (
    <>
      <p className="muted small">
        <Trans i18nKey="archiveExport.description" components={{ code: <code /> }} />
      </p>
      {size === null ? (
        <div>
          <button type="button" className="btn" onClick={ask} disabled={loading}>
            {loading ? <Loader size={16} className="spin" /> : <Download size={16} />}
            {t("archiveExport.export")}
          </button>
        </div>
      ) : (
        <div className="settings__field" role="alertdialog" aria-label={t("archiveExport.export")}>
          <p>{t("archiveExport.confirm", { size: formatBytes(size) })}</p>
          <div className="access__actions">
            <button type="button" className="btn" onClick={() => setSize(null)}>
              {t("common.cancel")}
            </button>
            <button type="button" className="btn btn--primary" onClick={download}>
              <Download size={16} />
              {t("archiveExport.download")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
