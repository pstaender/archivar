import { Download, FolderPlus, Layers, Loader, Trash, Upload, X } from "../icons";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { moveToFolders } from "../../shared/folders";
import type { LibraryItem } from "../../shared/types";
import { api } from "../api";
import { ConfirmDialog } from "../components/Dialog";
import { FolderTargetDialog } from "../components/FolderTargetDialog";
import { ItemCard, itemKey } from "../components/ItemCard";
import { useFolders } from "../hooks/folders";
import { useToast } from "../hooks/toast";
import { useUpload } from "../hooks/upload";
import { usePolling } from "../hooks/usePolling";
import { useResource } from "../hooks/useResource";
import { saveBlob } from "../download";
import { documentLabel, isOcrBusy } from "../format";
import { folderHref, useCurrentFolder } from "../routes";

const POLL_INTERVAL = 2500;

export function LibraryPage() {
  const [params] = useSearchParams();
  const folder = useCurrentFolder() ?? undefined;
  const q = params.get("q") ?? undefined;
  const legacyFolder = params.get("folder");
  const { version } = useUpload();
  const library = useResource(() => api.library({ folder, q }), [folder, q, version]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => setSelected(new Set()), [folder, q]);

  const items = library.data ?? [];
  const busy = items.some((item) => item.type === "document" && isOcrBusy(item.document));

  usePolling(busy, library.refresh, POLL_INTERVAL);

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedItems = items.filter((item) => selected.has(itemKey(item)));

  if (legacyFolder) {
    const rest = new URLSearchParams(params);
    rest.delete("folder");
    return <Navigate to={folderHref(legacyFolder, rest.toString())} replace />;
  }

  const title = q ? `Suche „${q}“` : folder ? folder.split("/").join(" / ") : "Alle Dokumente";

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{title}</h1>
          {!library.loading && (
            <p className="muted small">{items.length === 1 ? "1 Eintrag" : `${items.length} Einträge`}</p>
          )}
        </div>
      </header>

      {library.error && <div className="alert alert--error">{library.error.message}</div>}

      {!library.loading && items.length === 0 && !library.error && <EmptyLibrary filtered={Boolean(folder || q)} />}

      <div className="grid" aria-busy={library.loading}>
        {items.map((item) => {
          const key = itemKey(item);
          return (
            <ItemCard
              key={key}
              item={item}
              selected={selected.has(key)}
              selectionMode={selected.size > 0}
              onToggle={() => toggle(key)}
            />
          );
        })}
      </div>

      {selectedItems.length > 0 && (
        <SelectionBar
          items={selectedItems}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            void library.reload();
          }}
        />
      )}
    </div>
  );
}

function EmptyLibrary({ filtered }: { filtered: boolean }) {
  const { uploadToCurrentTarget } = useUpload();
  if (filtered) {
    return (
      <div className="empty-state">
        <p className="muted">Keine passenden Dokumente gefunden.</p>
      </div>
    );
  }
  return (
    <label className="empty-state empty-state--upload">
      <Upload size={28} strokeWidth={1.5} />
      <h2>Noch nichts archiviert</h2>
      <p className="muted">Fotos, Scans und PDFs hierher ziehen oder auswählen.</p>
      <span className="btn btn--primary">Dateien auswählen</span>
      <input
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = "";
          void uploadToCurrentTarget(files);
        }}
      />
    </label>
  );
}

interface SelectionBarProps {
  items: LibraryItem[];
  onClear: () => void;
  onDone: () => void;
}

export function SelectionBar({ items, onClear, onDone }: SelectionBarProps) {
  const toast = useToast();
  const navigate = useNavigate();
  const { reload: reloadFolders } = useFolders();
  const from = useCurrentFolder();
  const [folderDialog, setFolderDialog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  const [exporting, setExporting] = useState(false);

  const documentIds = useMemo(
    () => items.flatMap((item) => (item.type === "document" ? [item.document.id] : item.stack.documentIds)),
    [items],
  );

  const exportable = items.some((item) => item.type === "stack" || item.document.kind !== "file");

  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    try {
      await action();
    } catch (error) {
      toast.error(error);
    } finally {
      setWorking(false);
    }
  };

  const stack = () =>
    run(async () => {
      const created = await api.createStack({ documentIds });
      toast.success(`Stapel „${created.title}“ erstellt`);
      onDone();
      navigate(`/stacks/${created.id}`);
    });

  const fileFolders = (targets: string[], move: boolean) =>
    run(async () => {
      const next = (current: string[]) => (move ? moveToFolders(current, from, targets) : [...new Set([...current, ...targets])].sort());
      for (const item of items) {
        if (item.type === "document") await api.updateDocument(item.document.id, { folders: next(item.document.folders) });
        else await api.updateStack(item.stack.id, { folders: next(item.stack.folders) });
      }
      await reloadFolders();
      const where = targets.length === 1 ? `„${targets[0]}“` : `${targets.length} Ordner`;
      toast.success(move ? `In ${where} verschoben` : `Zu ${where} hinzugefügt`);
      setFolderDialog(false);
      onDone();
    });

  const exportPdf = () =>
    run(async () => {
      setExporting(true);
      try {
        const title = items.length === 1 ? (items[0]!.type === "stack" ? items[0]!.stack.title : documentLabel(items[0]!.document)) : undefined;
        const { blob, filename } = await api.exportCombinedPdf(documentIds, title);
        saveBlob(blob, filename);
      } finally {
        setExporting(false);
      }
    });

  const remove = () =>
    run(async () => {
      for (const id of documentIds) await api.deleteDocument(id);
      await reloadFolders();
      toast.success(documentIds.length === 1 ? "1 Dokument gelöscht" : `${documentIds.length} Dokumente gelöscht`);
      onDone();
    });

  return (
    <div className="selection-bar" role="toolbar" aria-label="Auswahl">
      <button type="button" className="btn btn--ghost btn--icon" onClick={onClear} aria-label="Auswahl aufheben">
        <X size={18} />
      </button>
      <span className="selection-bar__count">{items.length} ausgewählt</span>
      <div className="selection-bar__actions">
        <button type="button" className="btn" onClick={stack} disabled={working || documentIds.length === 0}>
          <Layers size={16} />
          <span className="hide-mobile">Stapeln</span>
        </button>
        <button type="button" className="btn" onClick={() => setFolderDialog(true)} disabled={working}>
          <FolderPlus size={16} />
          <span className="hide-mobile">Ordner</span>
        </button>
        <button type="button" className="btn" onClick={exportPdf} disabled={working || !exportable} title="Bilder und PDFs der Auswahl als ein PDF herunterladen">
          {exporting ? <Loader size={16} className="spin" /> : <Download size={16} />}
          <span className="hide-mobile">PDF</span>
        </button>
        <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)} disabled={working}>
          <Trash size={16} />
          <span className="hide-mobile">Löschen</span>
        </button>
      </div>

      <FolderTargetDialog
        open={folderDialog}
        from={from}
        working={working}
        onMove={(targets) => fileFolders(targets, true)}
        onAdd={(targets) => fileFolders(targets, false)}
        onClose={() => setFolderDialog(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Endgültig löschen"
        message={`${documentIds.length === 1 ? "1 Dokument" : `${documentIds.length} Dokumente`} inklusive aller Bearbeitungen und erkannter Texte löschen?`}
        confirmLabel="Löschen"
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
