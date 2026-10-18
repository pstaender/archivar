import { useState } from "react";
import { api } from "../api";
import { formatBytes } from "../format";
import { useToast } from "../hooks/toast";
import { Download, Loader } from "../icons";

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
    toast.success("Export gestartet");
  };

  return (
    <>
      <p className="muted small">
        Lädt das komplette Archiv als ZIP herunter: die SQLite-Datenbank (<code>archivar.sqlite</code>, mit den Daten aller Benutzer) und alle Bilder und Dateien
        (<code>files/</code>). In das Datenverzeichnis entpackt stellt es das Archiv wieder her. Auf dem Server geht das auch mit <code>bun run export</code>.
      </p>
      {size === null ? (
        <div>
          <button type="button" className="btn" onClick={ask} disabled={loading}>
            {loading ? <Loader size={16} className="spin" /> : <Download size={16} />}
            Archiv exportieren
          </button>
        </div>
      ) : (
        <div className="settings__field" role="alertdialog" aria-label="Archiv exportieren">
          <p>Möchtest du wirklich {formatBytes(size)} herunterladen?</p>
          <div className="access__actions">
            <button type="button" className="btn" onClick={() => setSize(null)}>
              Abbrechen
            </button>
            <button type="button" className="btn btn--primary" onClick={download}>
              <Download size={16} />
              Herunterladen
            </button>
          </div>
        </div>
      )}
    </>
  );
}
