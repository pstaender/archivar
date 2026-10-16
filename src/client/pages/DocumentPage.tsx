import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, Loader2, ScanText, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { ArchiveDocument, EditSettings } from "../../shared/types";
import { api, assetUrl } from "../api";
import { ConfirmDialog } from "../components/Dialog";
import { EditableTitle } from "../components/EditableTitle";
import { FolderPicker } from "../components/FolderPicker";
import { EditControls } from "../editor/EditControls";
import type { GeometryMode } from "../editor/geometry";
import { ImageEditor } from "../editor/ImageEditor";
import { useFolders } from "../hooks/folders";
import { useToast } from "../hooks/toast";
import { useResource } from "../hooks/useResource";
import { documentLabel, formatBytes, formatDateTime, isOcrBusy, OCR_STATUS_LABEL } from "../format";

type Tab = "edit" | "text" | "details";

export function DocumentPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const stackId = params.get("stack") ? Number(params.get("stack")) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const { reload: reloadFolders } = useFolders();
  const resource = useResource(() => api.document(id), [id]);
  const config = useResource(() => api.config(), []);
  const [dewarping, setDewarping] = useState(false);
  const stack = useResource(() => (stackId ? api.stack(stackId) : Promise.resolve(null)), [stackId]);
  const doc = resource.data;

  const [tab, setTab] = useState<Tab>("details");
  const [draft, setDraft] = useState<EditSettings>(DEFAULT_EDIT_SETTINGS);
  const [mode, setMode] = useState<GeometryMode>("none");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setDraft(doc.editSettings);
    setMode("none");
  }, [doc?.id]);

  useEffect(() => {
    if (doc) setTab((current) => (current === "edit" && doc.kind !== "image" ? "details" : current));
  }, [doc?.kind]);

  useEffect(() => {
    if (!doc || !isOcrBusy(doc)) return;
    const timer = setInterval(() => void resource.reload(), 2000);
    return () => clearInterval(timer);
  }, [doc?.ocrStatus, resource.reload]);

  const dirty = useMemo(() => doc !== undefined && JSON.stringify(draft) !== JSON.stringify(doc.editSettings), [draft, doc]);

  if (resource.error) {
    return (
      <div className="page">
        <div className="alert alert--error">{resource.error.message}</div>
        <Link to="/" className="btn">
          Zur Übersicht
        </Link>
      </div>
    );
  }
  if (!doc) return <div className="page-loading">Lade …</div>;

  const backHref = stackId ? `/stacks/${stackId}` : "/";
  const siblings = stack.data?.documentIds ?? [];
  const position = siblings.indexOf(doc.id);

  const update = async (change: Parameters<typeof api.updateDocument>[1]) => {
    try {
      const updated = await api.updateDocument(doc.id, change);
      resource.setData(updated);
      if (change.folders) void reloadFolders();
      return updated;
    } catch (error) {
      toast.error(error);
      return null;
    }
  };

  const save = async () => {
    setSaving(true);
    const updated = await update({ editSettings: draft });
    setSaving(false);
    if (updated) {
      setMode("none");
      toast.success("Bearbeitung gespeichert");
    }
  };

  const autoDewarp = async () => {
    setDewarping(true);
    try {
      const dewarp = await api.detectDewarp(doc.id, draft.rotation);
      setDraft((current) => ({ ...current, dewarp, corners: null }));
      setMode("none");
    } catch (error) {
      toast.error(error);
    } finally {
      setDewarping(false);
    }
  };

  const runOcr = async () => {
    if (dirty) await save();
    try {
      resource.setData(await api.runOcr(doc.id));
    } catch (error) {
      toast.error(error);
    }
  };

  const remove = async () => {
    try {
      await api.deleteDocument(doc.id);
      toast.success("Dokument gelöscht");
      void reloadFolders();
      navigate(backHref);
    } catch (error) {
      toast.error(error);
    }
  };

  const goTo = (offset: number) => {
    const target = siblings[position + offset];
    if (target) navigate(`/documents/${target}?stack=${stackId}`);
  };

  return (
    <div className="page page--document">
      <header className="page__header page__header--detail">
        <Link to={backHref} className="btn btn--ghost btn--icon" aria-label="Zurück">
          <ArrowLeft size={18} />
        </Link>
        <div className="page__title">
          <EditableTitle value={doc.title} placeholder={doc.originalName} onSave={(title) => update({ title })} />
          <p className="muted small">
            {stack.data ? (
              <>
                <Link to={backHref} className="underline">
                  {stack.data.title}
                </Link>{" "}
                · Seite {position + 1} von {siblings.length}
              </>
            ) : (
              <>
                {doc.originalName} · {formatBytes(doc.size)}
              </>
            )}
          </p>
        </div>
        <div className="page__actions">
          {stack.data && (
            <>
              <button type="button" className="btn btn--ghost btn--icon" onClick={() => goTo(-1)} disabled={position <= 0} aria-label="Vorherige Seite">
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                onClick={() => goTo(1)}
                disabled={position < 0 || position >= siblings.length - 1}
                aria-label="Nächste Seite"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
          <a href={assetUrl(doc, "file")} download={doc.originalName} className="btn btn--ghost btn--icon" aria-label="Original herunterladen" title="Original herunterladen">
            <Download size={18} />
          </a>
          <button type="button" className="btn btn--ghost btn--icon btn--danger-ghost" onClick={() => setConfirmDelete(true)} aria-label="Dokument löschen" title="Löschen">
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <div className="document-layout">
        <div className="viewer">
          <Viewer doc={doc} editing={tab === "edit"} draft={draft} mode={mode} onCornersChange={(corners) => setDraft({ ...draft, corners })} />
        </div>

        <aside className="panel">
          <div className="tabs" role="tablist">
            {doc.kind === "image" && (
              <TabButton tab="edit" current={tab} onSelect={setTab}>
                Bearbeiten
              </TabButton>
            )}
            <TabButton tab="text" current={tab} onSelect={setTab}>
              Text
            </TabButton>
            <TabButton tab="details" current={tab} onSelect={setTab}>
              Details
            </TabButton>
          </div>

          <div className="panel__body" role="tabpanel">
            {tab === "edit" && doc.kind === "image" && (
              <>
                <EditControls
                  settings={draft}
                  onChange={setDraft}
                  mode={mode}
                  onModeChange={setMode}
                  dewarpAvailable={config.data?.dewarpAvailable}
                  dewarping={dewarping}
                  onAutoDewarp={autoDewarp}
                />
                <div className="panel__footer">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(DEFAULT_EDIT_SETTINGS)}>
                    Zurücksetzen
                  </button>
                  <span className="spacer" />
                  <button type="button" className="btn btn--sm" onClick={() => setDraft(doc.editSettings)} disabled={!dirty || saving}>
                    Verwerfen
                  </button>
                  <button type="button" className="btn btn--sm btn--primary" onClick={save} disabled={!dirty || saving}>
                    {saving && <Loader2 size={16} className="spin" />}
                    Speichern
                  </button>
                </div>
              </>
            )}
            {tab === "text" && <TextPanel doc={doc} onRunOcr={runOcr} onSave={(ocrText) => update({ ocrText })} />}
            {tab === "details" && <DetailsPanel doc={doc} onFoldersChange={(folders) => update({ folders })} />}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Dokument löschen"
        message={`„${documentLabel(doc)}“ inklusive Bearbeitungen und erkanntem Text endgültig löschen?`}
        confirmLabel="Löschen"
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function TabButton({ tab, current, onSelect, children }: { tab: Tab; current: Tab; onSelect: (tab: Tab) => void; children: string }) {
  return (
    <button type="button" role="tab" aria-selected={tab === current} className={tab === current ? "is-active" : ""} onClick={() => onSelect(tab)}>
      {children}
    </button>
  );
}

interface ViewerProps {
  doc: ArchiveDocument;
  editing: boolean;
  draft: EditSettings;
  mode: GeometryMode;
  onCornersChange: (corners: NonNullable<EditSettings["corners"]>) => void;
}

function Viewer({ doc, editing, draft, mode, onCornersChange }: ViewerProps) {
  if (doc.kind === "image") {
    if (editing) return <ImageEditor src={assetUrl(doc, "preview")} settings={draft} mode={mode} onCornersChange={onCornersChange} />;
    return (
      <a href={assetUrl(doc, "image")} target="_blank" rel="noreferrer" className="viewer__image-link">
        <img src={assetUrl(doc, "image")} alt={documentLabel(doc)} className="viewer__image" />
      </a>
    );
  }
  if (doc.kind === "pdf") {
    return (
      <div className="viewer__pdf">
        <iframe src={assetUrl(doc, "file")} title={documentLabel(doc)} className="viewer__frame" />
        <a href={assetUrl(doc, "file")} target="_blank" rel="noreferrer" className="btn viewer__open">
          <ExternalLink size={16} />
          PDF öffnen
        </a>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <FileText size={40} strokeWidth={1.25} />
      <p className="muted">Für diesen Dateityp gibt es keine Vorschau.</p>
      <a href={assetUrl(doc, "file")} download={doc.originalName} className="btn">
        <Download size={16} />
        Herunterladen
      </a>
    </div>
  );
}

interface TextPanelProps {
  doc: ArchiveDocument;
  onRunOcr: () => void;
  onSave: (text: string) => Promise<unknown>;
}

export function TextPanel({ doc, onRunOcr, onSave }: TextPanelProps) {
  const toast = useToast();
  const [text, setText] = useState(doc.ocrText);
  const busy = isOcrBusy(doc);

  useEffect(() => setText(doc.ocrText), [doc.ocrText]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Text kopiert");
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="text-panel">
      <div className="text-panel__status">
        <span className={`status status--${doc.ocrStatus}`}>
          {busy && <Loader2 size={14} className="spin" />}
          {OCR_STATUS_LABEL[doc.ocrStatus]}
          {doc.ocrStatus === "done" && doc.ocrConfidence !== null && ` · ${Math.round(doc.ocrConfidence)} % Konfidenz`}
          {doc.metadata.textSource === "pdf" && " · aus PDF übernommen"}
        </span>
        {doc.kind !== "file" && (
          <button type="button" className="btn btn--sm" onClick={onRunOcr} disabled={busy}>
            <ScanText size={16} />
            {doc.ocrStatus === "none" ? "Text erkennen" : "Erneut erkennen"}
          </button>
        )}
      </div>
      {doc.ocrStatus === "failed" && doc.ocrError && <div className="alert alert--error">{doc.ocrError}</div>}
      <textarea
        className="textarea text-panel__text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={busy ? "Text wird erkannt …" : "Noch kein Text vorhanden."}
        disabled={busy}
        aria-label="Erkannter Text"
      />
      <div className="button-row">
        <button type="button" className="btn btn--sm btn--ghost" onClick={copy} disabled={!text}>
          <Copy size={14} />
          Kopieren
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn--sm" onClick={() => setText(doc.ocrText)} disabled={text === doc.ocrText}>
          Verwerfen
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={() => onSave(text)} disabled={text === doc.ocrText}>
          Text speichern
        </button>
      </div>
    </div>
  );
}

function DetailsPanel({ doc, onFoldersChange }: { doc: ArchiveDocument; onFoldersChange: (folders: string[]) => void }) {
  const rows: [string, string][] = [
    ["Datei", doc.originalName],
    ["Typ", doc.mimeType],
    ["Größe", formatBytes(doc.size)],
  ];
  if (doc.width && doc.height) rows.push(["Abmessungen", `${doc.width} × ${doc.height} px`]);
  if (doc.pageCount) rows.push(["Seiten", String(doc.pageCount)]);
  rows.push(["Hochgeladen", formatDateTime(doc.createdAt)], ["Geändert", formatDateTime(doc.updatedAt)]);

  return (
    <div className="details-panel">
      <FolderPicker value={doc.folders} onChange={onFoldersChange} />
      <dl className="details">
        {rows.map(([label, value]) => (
          <div key={label} className="details__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
