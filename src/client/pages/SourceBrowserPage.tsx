import { ChevronRight, FileText, Folder, FolderArrowDown, HardDrive, Loader, RefreshCw, X } from "../icons";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { ExternalEntry } from "../../shared/externalSources";
import { api } from "../api";
import { Dialog } from "../components/Dialog";
import { FolderPicker } from "../components/FolderPicker";
import { Switch } from "../components/Switch";
import { useFolders } from "../hooks/folders";
import { useJobs, useRefreshOnJobProgress } from "../hooks/jobs";
import { useToast } from "../hooks/toast";
import { useResource } from "../hooks/useResource";
import { formatBytes, formatDateTime } from "../format";
import { NotFoundPage } from "./NotFoundPage";
import { useTranslation } from "react-i18next";

const sourceHref = (id: number, path: string) => `/sources/${id}${path ? `?${new URLSearchParams({ path })}` : ""}`;

/** Browses an external data source; the selection (files and folders) is kept while moving between folders. */
export function SourceBrowserPage() {
  const { t } = useTranslation();
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const path = params.get("path") ?? "";
  const [allFiles, setAllFiles] = useState(false);
  const [selected, setSelected] = useState<Map<string, ExternalEntry["kind"]>>(new Map());
  const [importing, setImporting] = useState(false);
  const sources = useResource(() => api.sources(), []);
  const listing = useResource(() => api.browseSource(id, path, allFiles), [id, path, allFiles]);
  useRefreshOnJobProgress(listing.refresh);

  const source = sources.data?.find((s) => s.id === id);
  if (sources.data && !source) return <NotFoundPage />;

  const entries = listing.data?.entries ?? [];
  const toggle = (entry: ExternalEntry, on: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      if (on) next.set(entry.path, entry.kind);
      else next.delete(entry.path);
      return next;
    });
  const allSelected = entries.length > 0 && entries.every((entry) => selected.has(entry.path));
  const selectAll = (on: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      for (const entry of entries) {
        if (on) next.set(entry.path, entry.kind);
        else next.delete(entry.path);
      }
      return next;
    });

  const segments = path ? path.split("/") : [];

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <nav className="source-path" aria-label={t("sourceBrowser.path")}>
            <Link to="/sources" className="underline">
              {t("sources.title")}
            </Link>
            <ChevronRight size={14} aria-hidden />
            <Link to={sourceHref(id, "")} className="source-path__item" aria-current={path === "" ? "page" : undefined}>
              <HardDrive size={14} aria-hidden />
              {source?.name ?? "…"}
            </Link>
            {segments.map((segment, index) => {
              const to = segments.slice(0, index + 1).join("/");
              return (
                <span key={to} className="source-path__item">
                  <ChevronRight size={14} aria-hidden />
                  <Link to={sourceHref(id, to)} aria-current={to === path ? "page" : undefined}>
                    {segment}
                  </Link>
                </span>
              );
            })}
          </nav>
          <h1>{segments.at(-1) ?? source?.name ?? ""}</h1>
        </div>
        <label className="switch">
          <input type="checkbox" checked={allFiles} onChange={(e) => setAllFiles(e.target.checked)} />
          <span className="switch__track" aria-hidden />
          {t("sourceBrowser.allFiles")}
        </label>
      </header>

      {listing.loading && <Loader size={20} className="spin" aria-label={t("sources.loading")} />}
      {listing.error && !listing.loading && (
        <div className="empty-state" role="alert">
          <p className="muted">{listing.error.message}</p>
        </div>
      )}
      {listing.data && !listing.loading && (
        <>
          {entries.length === 0 ? (
            <div className="empty-state">
              <p className="muted">{t("sourceBrowser.empty")}</p>
            </div>
          ) : (
            <table className="source-table">
              <thead>
                <tr>
                  <th className="source-table__check">
                    <input type="checkbox" checked={allSelected} onChange={(e) => selectAll(e.target.checked)} aria-label={t("sourceBrowser.selectAll")} />
                  </th>
                  <th>{t("sourceBrowser.name")}</th>
                  <th className="source-table__size">{t("sourceBrowser.size")}</th>
                  <th className="source-table__date">{t("sourceBrowser.modified")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.path} className={selected.has(entry.path) ? "is-selected" : undefined}>
                    <td className="source-table__check">
                      <input
                        type="checkbox"
                        checked={selected.has(entry.path)}
                        onChange={(e) => toggle(entry, e.target.checked)}
                        aria-label={t("sourceBrowser.select", { name: entry.name })}
                      />
                    </td>
                    <td>
                      <span className="source-table__name">
                        {entry.kind === "folder" ? (
                          <>
                            <Folder size={16} aria-hidden />
                            <Link to={sourceHref(id, entry.path)}>{entry.name}</Link>
                          </>
                        ) : (
                          <>
                            <FileText size={16} aria-hidden />
                            <span>{entry.name}</span>
                          </>
                        )}
                        {entry.documentId !== null && (
                          <Link to={`/documents/${entry.documentId}`} className="preset-card__badge">
                            {entry.changed ? t("sourceBrowser.changed") : t("sourceBrowser.imported")}
                          </Link>
                        )}
                        {entry.documentId !== null && entry.changed && <ReimportButton documentId={entry.documentId} onDone={listing.refresh} />}
                      </span>
                    </td>
                    <td className="source-table__size muted">{entry.size === null ? "" : formatBytes(entry.size)}</td>
                    <td className="source-table__date muted">{entry.modifiedAt ? formatDateTime(entry.modifiedAt) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {listing.data.hidden > 0 && <p className="muted small">{t("sourceBrowser.hidden", { count: listing.data.hidden })}</p>}
        </>
      )}

      {selected.size > 0 && (
        <div className="selection-bar" role="toolbar" aria-label={t("selection.label")}>
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={() => setSelected(new Map())} aria-label={t("sourceBrowser.clear")}>
            <X size={16} />
          </button>
          <span className="selection-bar__count">{t("selection.count", { count: selected.size })}</span>
          <div className="selection-bar__actions">
            <button type="button" className="btn btn--sm btn--primary" onClick={() => setImporting(true)}>
              <FolderArrowDown size={16} />
              {t("sourceBrowser.import")}
            </button>
          </div>
        </div>
      )}

      <ImportDialog
        open={importing}
        sourceId={id}
        base={path}
        allFiles={allFiles}
        selected={selected}
        onClose={() => setImporting(false)}
        onStarted={() => {
          setImporting(false);
          setSelected(new Map());
        }}
      />
    </div>
  );
}

function ReimportButton({ documentId, onDone }: { documentId: number; onDone: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const reimport = async () => {
    setBusy(true);
    try {
      await api.reimportDocument(documentId);
      toast.success(t("details.reimported"));
      onDone();
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn--sm" onClick={reimport} disabled={busy} title={t("details.reimportTitle")}>
      {busy ? <Loader size={16} className="spin" /> : <RefreshCw size={16} />}
      {t("details.reimport")}
    </button>
  );
}

interface ImportDialogProps {
  open: boolean;
  sourceId: number;
  base: string;
  allFiles: boolean;
  selected: Map<string, ExternalEntry["kind"]>;
  onClose: () => void;
  onStarted: () => void;
}

function ImportDialog({ open, sourceId, base, allFiles, selected, onClose, onStarted }: ImportDialogProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const jobs = useJobs();
  const { reload: reloadFolders } = useFolders();
  const [recursive, setRecursive] = useState(false);
  const [keepStructure, setKeepStructure] = useState(false);
  const [targetFolders, setTargetFolders] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);

  const files = [...selected].filter(([, kind]) => kind === "file").map(([path]) => path);
  const folders = [...selected].filter(([, kind]) => kind === "folder").map(([path]) => path);

  const start = async () => {
    setStarting(true);
    try {
      const job = await api.importFromSource(sourceId, { files, folders, recursive, allFiles, keepStructure, base, targetFolders });
      const queued = job.items.filter((item) => item.state !== "skipped").length;
      const skipped = job.items.length - queued;
      toast.success(skipped > 0 ? t("sourceBrowser.startedSkipped", { count: queued, skipped }) : t("sourceBrowser.started", { count: queued }));
      await Promise.all([jobs.reload(), reloadFolders()]);
      onStarted();
    } catch (error) {
      toast.error(error);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog
      open={open}
      title={t("sourceBrowser.importTitle")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn btn--primary" onClick={start} disabled={starting}>
            {starting ? <Loader size={16} className="spin" /> : <FolderArrowDown size={16} />}
            {t("sourceBrowser.import")}
          </button>
        </>
      }
    >
      <div className="import-options">
        <p className="small">{t("sourceBrowser.summary", { files: t("sourceBrowser.files", { count: files.length }), folders: t("sourceBrowser.folders", { count: folders.length }) })}</p>
        {folders.length > 0 && (
          <Switch checked={recursive} onChange={setRecursive} hint={t("sourceBrowser.recursiveHint")}>
            {t("sourceBrowser.recursive")}
          </Switch>
        )}
        <Switch checked={keepStructure} onChange={setKeepStructure} hint={t("sourceBrowser.keepStructureHint")}>
          {t("sourceBrowser.keepStructure")}
        </Switch>
        <FolderPicker value={targetFolders} onChange={setTargetFolders} label={t("sourceBrowser.targetFolders")} />
        <p className="muted small">{t("sourceBrowser.settingsHint")}</p>
      </div>
    </Dialog>
  );
}
