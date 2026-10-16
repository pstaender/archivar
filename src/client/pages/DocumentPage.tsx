import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, Loader, ScanText, Trash } from "../icons";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { ArchiveDocument, BwVariant, EditSettings } from "../../shared/types";
import { api, assetUrl } from "../api";
import { ConfirmDialog } from "../components/Dialog";
import { EditableTitle } from "../components/EditableTitle";
import { FolderPicker } from "../components/FolderPicker";
import { ZoomableImage } from "../components/ZoomableImage";
import { type AutoBwState, EditControls } from "../editor/EditControls";
import type { GeometryMode } from "../editor/geometry";
import { ImageEditor } from "../editor/ImageEditor";
import { useProcessedPreview } from "../editor/useProcessedPreview";
import { useConfig } from "../hooks/config";
import { useFolders } from "../hooks/folders";
import { useUpload } from "../hooks/upload";
import { useToast } from "../hooks/toast";
import { useResource } from "../hooks/useResource";
import { documentLabel, formatBytes, formatDateTime, isOcrBusy, OCR_STATUS_LABEL } from "../format";

type Tab = "edit" | "text" | "details";

const bwKey = (s: EditSettings) => JSON.stringify([s.rotation, s.dewarp, s.corners, s.denoise]);

const isBwVariant = (s: EditSettings, v: BwVariant) =>
  s.colorMode === "bw" && !s.autoLevels && s.brightness === v.brightness && s.contrast === v.contrast && s.bwThreshold === v.bwThreshold;

export function autoBwState(draft: EditSettings, cache: { key: string; variants: BwVariant[] } | null): AutoBwState | null {
  if (!cache || cache.key !== bwKey(draft)) return null;
  const index = cache.variants.findIndex((v) => isBwVariant(draft, v));
  if (index < 0) return null;
  const best = cache.variants[0]!.bwThreshold;
  const threshold = cache.variants[index]!.bwThreshold;
  return { index, count: cache.variants.length, shade: index === 0 ? "best" : threshold > best ? "darker" : "lighter" };
}

export function DocumentPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const stackId = params.get("stack") ? Number(params.get("stack")) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const { reload: reloadFolders } = useFolders();
  const { ocrAllText } = useUpload();
  const resource = useResource(() => api.document(id), [id]);
  const config = useConfig();
  const [dewarping, setDewarping] = useState(false);
  const [bwCache, setBwCache] = useState<{ key: string; variants: BwVariant[] } | null>(null);
  const [bwLoading, setBwLoading] = useState(false);
  const stack = useResource(() => (stackId ? api.stack(stackId) : Promise.resolve(null)), [stackId]);
  const doc = resource.data;

  const [tab, setTab] = useState<Tab>("text");
  const [draft, setDraft] = useState<EditSettings>(DEFAULT_EDIT_SETTINGS);
  const [mode, setMode] = useState<GeometryMode>("none");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const processed = useProcessedPreview(doc?.id, draft, toast.error);

  useEffect(() => {
    if (!doc) return;
    setDraft(doc.editSettings);
    setMode("none");
    setBwCache(null);
  }, [doc?.id]);

  useEffect(() => {
    if (doc) setTab((current) => (current === "edit" && doc.kind !== "image" ? "text" : current));
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

  const bwState = autoBwState(draft, bwCache);
  const applyBw = (variant: BwVariant) => setDraft((current) => ({ ...current, ...variant, colorMode: "bw", autoLevels: false }));

  const autoBw = async () => {
    const key = bwKey(draft);
    if (bwCache?.key === key) {
      const next = bwState ? (bwState.index + 1) % bwState.count : 0;
      applyBw(bwCache.variants[next]!);
      return;
    }
    setBwLoading(true);
    try {
      const variants = await api.autoBw(doc.id, draft);
      setBwCache({ key, variants });
      if (variants[0]) applyBw(variants[0]);
    } catch (error) {
      toast.error(error);
    } finally {
      setBwLoading(false);
    }
  };

  const runOcr = async (allText = ocrAllText) => {
    if (dirty) await save();
    try {
      resource.setData(await api.runOcr(doc.id, { allText }));
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
            <Trash size={18} />
          </button>
        </div>
      </header>

      <div className="document-layout">
        <div className="viewer">
          <Viewer
            doc={doc}
            editing={tab === "edit"}
            draft={draft}
            mode={mode}
            onCornersChange={(corners) => setDraft({ ...draft, corners })}
            processed={processed}
          />
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
                  dewarpAvailable={config.dewarpAvailable}
                  dewarping={dewarping}
                  onAutoDewarp={autoDewarp}
                  autoBw={bwState}
                  bwLoading={bwLoading}
                  onAutoBw={autoBw}
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
                    {saving && <Loader size={16} className="spin" />}
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
  processed: ReturnType<typeof useProcessedPreview>;
}

function Viewer({ doc, editing, draft, mode, onCornersChange, processed }: ViewerProps) {
  if (doc.kind === "image") {
    if (editing) {
      return (
        <ImageEditor
          src={assetUrl(doc, "preview")}
          settings={draft}
          mode={mode}
          onCornersChange={onCornersChange}
          processedSrc={processed.src}
          processing={processed.processing}
          onPreview={() => void processed.request()}
          onLive={processed.clear}
        />
      );
    }
    return <ZoomableImage src={assetUrl(doc, "image")} alt={documentLabel(doc)} />;
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
  onRunOcr: (allText?: boolean) => void;
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
          {busy && <Loader size={14} className="spin" />}
          {OCR_STATUS_LABEL[doc.ocrStatus]}
          {doc.ocrStatus === "done" && doc.ocrConfidence !== null && ` · ${Math.round(doc.ocrConfidence)} % Konfidenz`}
          {doc.metadata.textSource === "pdf" && " · aus PDF übernommen"}
        </span>
        {doc.kind !== "file" && (
          <button type="button" className="btn btn--sm" onClick={() => onRunOcr()} disabled={busy}>
            <ScanText size={16} />
            {doc.ocrStatus === "none" ? "Text erkennen" : "Erneut erkennen"}
          </button>
        )}
      </div>
      {doc.ocrStatus === "failed" && doc.ocrError && <div className="alert alert--error">{doc.ocrError}</div>}
      {doc.ocrStatus === "done" && doc.ocrRemoved > 0 && (
        <p className="muted small">
          {doc.ocrRemoved === 1 ? "1 unsicherer Textteil wurde" : `${doc.ocrRemoved} unsichere Textteile wurden`} als vermutlich fehlerhaft
          ausgeblendet.{" "}
          <button type="button" className="link-button" onClick={() => onRunOcr(true)}>
            Alle Textteile erkennen
          </button>
        </p>
      )}
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
