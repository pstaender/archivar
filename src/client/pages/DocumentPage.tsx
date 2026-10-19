import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, Loader, SavePlus, ScanText, RefreshCw, Trash, Unlink } from "../icons";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import { OCR_LANGUAGES } from "../../shared/languages";
import { type PresetSteps, presetStepsFromSettings } from "../../shared/presets";
import type { PdfQuality } from "../../shared/settings";
import { SHAPE_COLORS, type Shape } from "../../shared/shapes";
import type { ArchiveDocument, BwVariant, EditSettings, Quad, Rotation } from "../../shared/types";
import { api, assetUrl, type OcrRequest } from "../api";
import { saveBlob } from "../download";
import { saveEditSettings, useEditSaving, whenEditsSaved } from "../editSaves";
import { ConfirmDialog } from "../components/Dialog";
import { EditableTitle } from "../components/EditableTitle";
import { FolderPicker } from "../components/FolderPicker";
import { PdfButton } from "../components/PdfButton";
import { PresetDialog } from "../components/PresetDialog";
import { type TabItem, TabBar } from "../components/TabBar";
import { UnsavedChangesDialog } from "../components/UnsavedChangesDialog";
import { ZoomableImage } from "../components/ZoomableImage";
import { type AutoBwState, EditControls } from "../editor/EditControls";
import { type GeometryMode, withRotation } from "../editor/geometry";
import { ImageEditor } from "../editor/ImageEditor";
import { ShapeCanvas, ShapeControls } from "../editor/ShapeEditor";
import { useVectorAreas } from "../editor/useVectorAreas";
import { VectorCanvas, VectorControls } from "../editor/VectorEditor";
import { useProcessedPreview } from "../editor/useProcessedPreview";
import { isAxisAlignedRect } from "../../shared/image/perspective";
import { useConfig } from "../hooks/config";
import { useFolders } from "../hooks/folders";
import { usePresets } from "../hooks/presets";
import { useSettings } from "../hooks/settings";
import { useLeaveGuard } from "../hooks/leaveGuard";
import { useArrowNavigation } from "../hooks/arrowNavigation";
import { documentOrder, itemHash, libraryLocation } from "../documentOrder";
import { usePolling } from "../hooks/usePolling";
import { useToast } from "../hooks/toast";
import { useResource } from "../hooks/useResource";
import { documentLabel, formatBytes, formatDateTime, isOcrBusy, ocrLanguageName, ocrStatusLabel } from "../format";
import { useTranslation } from "react-i18next";
import { translateServerMessage } from "../serverMessages";

type Tab = "edit" | "text" | "vectors" | "shapes" | "details";

const IMAGE_TABS: Tab[] = ["edit", "vectors", "shapes"];
const TABS: Tab[] = ["edit", "text", "vectors", "shapes", "details"];
const TAB_KEY = "archivar.documentTab";

const MAIN_TABS: Tab[] = ["text", "details"];
const MORE_TABS: Tab[] = ["vectors", "shapes"];

/** The tab chosen last, for all documents. */
function storedTab(): Tab {
  try {
    const tab = localStorage.getItem(TAB_KEY) as Tab | null;
    return tab && TABS.includes(tab) ? tab : "text";
  } catch {
    return "text";
  }
}

function storeTab(tab: Tab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // The tab is then just not remembered.
  }
}

const OCR_POLL_INTERVAL = 2000;

const bwKey = (s: EditSettings) => JSON.stringify([s.rotation, s.dewarp, s.corners, s.denoise, s.autoLevels]);

const isBwVariant = (s: EditSettings, v: BwVariant) =>
  s.colorMode === "bw" && s.brightness === v.brightness && s.contrast === v.contrast && s.bwThreshold === v.bwThreshold;

export function autoBwState(draft: EditSettings, cache: { key: string; variants: BwVariant[] } | null): AutoBwState | null {
  if (!cache || cache.key !== bwKey(draft)) return null;
  const index = cache.variants.findIndex((v) => isBwVariant(draft, v));
  if (index < 0) return null;
  const best = cache.variants[0]!.bwThreshold;
  const threshold = cache.variants[index]!.bwThreshold;
  return { index, count: cache.variants.length, shade: index === 0 ? "best" : threshold > best ? "darker" : "lighter" };
}

/** Values the automatic tools produced, to tell them apart from values set by hand when saving a preset. */
interface AutoValues {
  rotation?: Rotation;
  corners?: Quad;
  bw?: BwVariant;
}

export function DocumentPage() {
  const id = Number(useParams().id);
  const [params] = useSearchParams();
  const stackId = params.get("stack") ? Number(params.get("stack")) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
  const { reload: reloadFolders } = useFolders();
  const { ocrAllText } = useSettings().settings;
  const resource = useResource(() => api.document(id), [id]);
  const config = useConfig();
  const [dewarping, setDewarping] = useState(false);
  const [bwCache, setBwCache] = useState<{ key: string; variants: BwVariant[] } | null>(null);
  const [bwLoading, setBwLoading] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [autoValues, setAutoValues] = useState<AutoValues>({});
  const [applyingPreset, setApplyingPreset] = useState(false);
  /** Steps offered by the open „Bildeinstellung speichern“ dialog. */
  const [presetDialogSteps, setPresetDialogSteps] = useState<PresetSteps | null>(null);
  const { presets, reload: reloadPresets } = usePresets();
  const stack = useResource(() => (stackId ? api.stack(stackId) : Promise.resolve(null)), [stackId]);
  const doc = resource.data;

  const [tab, setTab] = useState<Tab>(storedTab);
  const [draft, setDraft] = useState<EditSettings>(DEFAULT_EDIT_SETTINGS);
  const [mode, setMode] = useState<GeometryMode>("none");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [shapeColor, setShapeColor] = useState(SHAPE_COLORS[0]!.color);
  const [savingShapes, setSavingShapes] = useState(false);
  const vectors = useVectorAreas(doc, toast.error);
  const [showOriginal, setShowOriginal] = useState(false);
  const processed = useProcessedPreview(doc?.id, draft, toast.error);
  const saving = useEditSaving(doc?.id);

  useEffect(() => {
    if (!doc) return;
    setDraft(doc.editSettings);
    setMode("none");
    setBwCache(null);
    setAutoValues({});
    setShapes(doc.shapes);
    setSelectedShape(null);
  }, [doc?.id]);

  useEffect(() => {
    if (doc) setTab((current) => (IMAGE_TABS.includes(current) && doc.kind !== "image" ? "text" : current));
  }, [doc?.kind]);

  usePolling(Boolean(doc && isOcrBusy(doc)), resource.refresh, OCR_POLL_INTERVAL);

  const dirty = useMemo(() => doc !== undefined && JSON.stringify(draft) !== JSON.stringify(doc.editSettings), [draft, doc]);
  const shapesDirty = useMemo(() => doc !== undefined && JSON.stringify(shapes) !== JSON.stringify(doc.shapes), [shapes, doc]);
  const vectorsDirty = vectors.dirty || vectors.pending;
  const leave = useLeaveGuard(dirty || shapesDirty || vectorsDirty);

  // Inside a stack its pages, otherwise the documents of the library page it was opened from.
  const libraryOrder = useMemo(() => documentOrder(), [id]);
  const siblings = stackId ? (stack.data?.documentIds ?? []) : libraryOrder;
  const position = doc ? siblings.indexOf(doc.id) : -1;
  const neighbour = (offset: number) => (position >= 0 ? siblings[position + offset] : undefined);
  const goTo = (offset: number) => {
    const target = neighbour(offset);
    if (target) navigate(stackId ? `/documents/${target}?stack=${stackId}` : `/documents/${target}`);
  };
  useArrowNavigation(neighbour(-1) ? () => goTo(-1) : null, neighbour(1) ? () => goTo(1) : null);

  if (resource.error) {
    return (
      <div className="page">
        <div className="alert alert--error">{resource.error.message}</div>
        <Link to="/" className="btn">
          {t("notFound.home")}
        </Link>
      </div>
    );
  }
  if (!doc) return <div className="page-loading">{t("stack.loading")}</div>;

  const backHref = (stackId ? `/stacks/${stackId}` : libraryLocation()) + itemHash({ type: "document", id: doc.id });

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

  // The page treats the settings as saved right away; the server renders the image in the background.
  const save = () => {
    const previous = doc.editSettings;
    const settings = draft;
    const sameDoc = (current: ArchiveDocument | undefined): current is ArchiveDocument => current?.id === doc.id;
    resource.setData((current) => (sameDoc(current) ? { ...current, editSettings: settings } : current!));
    setMode("none");
    saveEditSettings(doc.id, settings).then(
      ({ doc: saved, latest }) => {
        if (latest) resource.setData((current) => (sameDoc(current) ? saved : current!));
        toast.success(t("document.editSaved", { title: documentLabel(saved) }));
      },
      (error: Error & { latest?: boolean }) => {
        if (error.latest) resource.setData((current) => (sameDoc(current) ? { ...current, editSettings: previous } : current!));
        toast.error(error);
      },
    );
  };

  const saveShapes = async () => {
    setSavingShapes(true);
    try {
      const updated = await api.updateDocument(doc.id, { shapes });
      resource.setData(updated);
      setShapes(updated.shapes);
      setSelectedShape((current) => (updated.shapes.some((s) => s.id === current) ? current : null));
      toast.success(updated.ocrStatus === "pending" ? t("document.shapesSavedOcr") : t("document.shapesSaved"));
    } catch (error) {
      toast.error(error);
    } finally {
      setSavingShapes(false);
    }
  };

  const discardShapes = () => {
    setShapes(doc.shapes);
    setSelectedShape(null);
  };

  const saveVectors = async () => {
    const updated = await vectors.save();
    if (!updated) return;
    resource.setData(updated);
    toast.success(updated.ocrStatus === "pending" ? t("document.vectorsSavedOcr") : t("document.vectorsSaved"));
  };

  const unsavedIn = (current: Tab) =>
    (current === "edit" && dirty) || (current === "shapes" && shapesDirty) || (current === "vectors" && vectorsDirty);
  const chooseTab = (next: Tab) => {
    storeTab(next);
    setTab(next);
  };
  const selectTab = (next: Tab) => (next !== tab && unsavedIn(tab) ? leave.guard(() => chooseTab(next)) : chooseTab(next));

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

  const autoRotate = async () => {
    setRotating(true);
    try {
      const { rotation } = await api.detectOrientation(doc.id);
      if (rotation !== null) setAutoValues((current) => ({ ...current, rotation }));
      if (rotation === null) toast.show(t("document.noOrientation"), "warning");
      else if (rotation === draft.rotation) toast.show(t("document.alreadyUpright"));
      else {
        setDraft((current) => withRotation(current, rotation));
        setMode("none");
      }
    } catch (error) {
      toast.error(error);
    } finally {
      setRotating(false);
    }
  };

  const autoCrop = async () => {
    setCropping(true);
    const requested = draft;
    try {
      const { corners } = await api.autoCrop(doc.id, requested);
      if (!corners) toast.show(t("document.noEdges"), "warning");
      else {
        setAutoValues((current) => ({ ...current, corners }));
        // Corners are relative to the rotated and dewarped image they were detected in.
        setDraft((current) =>
          current.rotation === requested.rotation && current.dewarp === requested.dewarp ? { ...current, corners } : current,
        );
        setMode(isAxisAlignedRect(corners) ? "crop" : "perspective");
      }
    } catch (error) {
      toast.error(error);
    } finally {
      setCropping(false);
    }
  };

  const bwState = autoBwState(draft, bwCache);
  const applyBw = (variant: BwVariant) => {
    setAutoValues((current) => ({ ...current, bw: variant }));
    setDraft((current) => ({ ...current, ...variant, colorMode: "bw" }));
  };

  const presetCandidates: PresetSteps = {
    ...presetStepsFromSettings(draft, {
      rotation: autoValues.rotation !== undefined && autoValues.rotation === draft.rotation,
      crop: draft.corners !== null && draft.corners === autoValues.corners,
      bw: bwState !== null || (autoValues.bw !== undefined && isBwVariant(draft, autoValues.bw)),
    }),
    ...(shapes.length > 0 ? { shapes } : {}),
  };

  const applyPreset = async (presetId: number) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;
    setApplyingPreset(true);
    try {
      const { editSettings, shapes: presetShapes } = await api.applyPreset(doc.id, preset.id, draft);
      if (presetShapes) {
        setShapes(presetShapes);
        setSelectedShape(null);
        toast.show(t("document.presetShapes"));
      }
      const { steps } = preset;
      setAutoValues((current) => ({
        rotation: steps.autoRotate ? editSettings.rotation : current.rotation,
        corners: steps.autoCrop && editSettings.corners ? editSettings.corners : current.corners,
        bw: steps.autoBw ? { brightness: editSettings.brightness, contrast: editSettings.contrast, bwThreshold: editSettings.bwThreshold } : current.bw,
      }));
      setDraft(editSettings);
      setMode("none");
    } catch (error) {
      toast.error(error);
    } finally {
      setApplyingPreset(false);
    }
  };

  const createPreset = async (name: string, steps: PresetSteps) => {
    try {
      await api.createPreset({ name, steps });
      await reloadPresets();
      toast.success(t("document.presetSaved", { name }));
    } catch (error) {
      toast.error(error);
      throw error;
    }
  };

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

  const runOcr = async ({ allText = ocrAllText, languages }: OcrRequest = {}) => {
    if (dirty) save();
    try {
      await whenEditsSaved(doc.id);
      resource.setData(await api.runOcr(doc.id, { allText, languages }));
    } catch (error) {
      toast.error(error);
    }
  };

  const remove = async () => {
    try {
      await api.deleteDocument(doc.id);
      toast.success(t("document.deleted"));
      void reloadFolders();
      leave.skipNext();
      navigate(backHref);
    } catch (error) {
      toast.error(error);
    }
  };

  const duplicate = async () => {
    try {
      await whenEditsSaved(doc.id);
      const copy = await api.duplicateDocument(doc.id);
      toast.success(t("document.duplicated"));
      void reloadFolders();
      if (stackId) void stack.refresh();
      navigate(stackId ? `/documents/${copy.id}?stack=${stackId}` : `/documents/${copy.id}`);
    } catch (error) {
      toast.error(error);
    }
  };

  const detach = async () => {
    try {
      resource.setData(await api.detachDocument(doc.id));
      toast.success(t("document.detached"));
    } catch (error) {
      toast.error(error);
    }
  };

  const reimport = async () => {
    try {
      await whenEditsSaved(doc.id);
      resource.setData(await api.reimportDocument(doc.id));
      toast.success(t("details.reimported"));
      if (stackId) void stack.refresh();
    } catch (error) {
      toast.error(error);
    }
  };

  const heir = doc.copies[0];
  const deleteMessage =
    t("document.deleteText", { title: documentLabel(doc) }) + (heir ? t("document.deleteHeir", { count: doc.copies.length, heir: heir.title }) : "");
  const tabItems = (ids: Tab[]): TabItem<Tab>[] => ids.map((tabId) => ({ id: tabId, label: t(`document.tabs.${tabId}`) }));

  return (
    <div className="page page--document">
      <header className="page__header page__header--detail">
        <Link to={backHref} className="btn btn--ghost btn--icon" aria-label={t("common.back")}>
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
                · {t("document.pageOf", { page: position + 1, count: siblings.length })}
              </>
            ) : (
              <>
                {doc.originalName} · {formatBytes(doc.size)}
              </>
            )}
          </p>
        </div>
        <div className="page__actions">
          {(stack.data || (position >= 0 && siblings.length > 1)) && (
            <>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                onClick={() => goTo(-1)}
                disabled={!neighbour(-1)}
                aria-label={stack.data ? t("document.previousPage") : t("document.previousDocument")}
                title={`${stack.data ? t("document.previousPage") : t("document.previousDocument")} (←)`}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--icon"
                onClick={() => goTo(1)}
                disabled={!neighbour(1)}
                aria-label={stack.data ? t("document.nextPage") : t("document.nextDocument")}
                title={`${stack.data ? t("document.nextPage") : t("document.nextDocument")} (→)`}
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
          <a href={assetUrl(doc, "file")} download={doc.originalName} className="btn btn--ghost btn--icon" aria-label={t("document.downloadOriginal")} title={t("document.downloadOriginal")}>
            <Download size={18} />
          </a>
          <button type="button" className="btn btn--ghost btn--icon btn--danger-ghost" onClick={() => setConfirmDelete(true)} aria-label={t("document.delete")} title={t("common.delete")}>
            <Trash size={18} />
          </button>
        </div>
      </header>

      <div className="document-layout">
        <div className="viewer">
          {tab === "vectors" && doc.kind === "image" ? (
            <VectorCanvas src={assetUrl(doc, "edited")} alt={documentLabel(doc)} state={vectors} showOriginal={showOriginal} />
          ) : tab === "shapes" && doc.kind === "image" ? (
            <ShapeCanvas
              src={assetUrl(doc, "edited")}
              alt={documentLabel(doc)}
              shapes={shapes}
              selected={selectedShape}
              color={shapeColor}
              onChange={setShapes}
              onSelect={setSelectedShape}
            />
          ) : (
            <Viewer
              doc={doc}
              editing={tab === "edit"}
              draft={draft}
              mode={mode}
              onCornersChange={(corners) => setDraft({ ...draft, corners })}
              processed={processed}
              shapes={shapes}
            />
          )}
        </div>

        <aside className="panel">
          <TabBar
            tabs={tabItems(doc.kind === "image" ? ["edit", ...MAIN_TABS] : MAIN_TABS)}
            more={doc.kind === "image" ? tabItems(MORE_TABS) : []}
            current={tab}
            onSelect={selectTab}
          />

          <div className="panel__body" role="tabpanel">
            {tab === "edit" && doc.kind === "image" && (
              <>
                <div className="preset-bar">
                  <select
                    className="input input--sm"
                    aria-label={t("document.applyPreset")}
                    value=""
                    disabled={applyingPreset || presets.length === 0}
                    onChange={(e) => applyPreset(Number(e.target.value))}
                  >
                    <option value="">{presets.length ? t("document.applyPresetOption") : t("document.noPresets")}</option>
                    {presets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  {applyingPreset && <Loader size={16} className="spin" aria-label={t("document.applying")} />}
                  <button
                    type="button"
                    className="btn btn--sm btn--icon"
                    onClick={() => setPresetDialogSteps(presetCandidates)}
                    disabled={Object.keys(presetCandidates).length === 0}
                    aria-label={t("document.savePreset")}
                    title={t("document.savePresetTitle")}
                  >
                    <SavePlus size={16} />
                  </button>
                </div>
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
                  rotating={rotating}
                  onAutoRotate={autoRotate}
                  cropping={cropping}
                  onAutoCrop={config.autoCropAvailable ? autoCrop : undefined}
                />
                <div className="panel__footer">
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(DEFAULT_EDIT_SETTINGS)}>
                    {t("editControls.reset")}
                  </button>
                  <span className="spacer saving-hint">
                    {saving && (
                      <span className="muted small" role="status">
                        <Loader size={14} className="spin" /> {t("shapes.saving")}
                      </span>
                    )}
                  </span>
                  <button type="button" className="btn btn--sm" onClick={() => setDraft(doc.editSettings)} disabled={!dirty}>
                    {t("unsaved.discard")}
                  </button>
                  <button type="button" className="btn btn--sm btn--primary" onClick={save} disabled={!dirty}>
                    {t("common.save")}
                  </button>
                </div>
              </>
            )}
            {tab === "text" && <TextPanel doc={doc} onRunOcr={runOcr} onSave={(ocrText) => update({ ocrText })} />}
            {tab === "vectors" && doc.kind === "image" && (
              <VectorControls
                state={vectors}
                showOriginal={showOriginal}
                onShowOriginal={setShowOriginal}
                hasText={doc.ocrStatus !== "none"}
                onSave={() => void saveVectors()}
              />
            )}
            {tab === "shapes" && doc.kind === "image" && (
              <ShapeControls
                shapes={shapes}
                selected={selectedShape}
                color={shapeColor}
                outdated={doc.shapesOutdated}
                hasText={doc.ocrStatus !== "none"}
                dirty={shapesDirty}
                saving={savingShapes}
                onColorChange={setShapeColor}
                onChange={setShapes}
                onSelect={setSelectedShape}
                onSave={() => void saveShapes()}
                onDiscard={discardShapes}
                onSavePreset={() => setPresetDialogSteps({ shapes })}
              />
            )}
            {tab === "details" && (
              <DetailsPanel doc={doc} onFoldersChange={(folders) => update({ folders })} onDuplicate={duplicate} onDetach={detach} onReimport={reimport} />
            )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={t("document.delete")}
        message={deleteMessage}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
      <PresetDialog
        open={presetDialogSteps !== null}
        title={t("document.savePresetDialog")}
        initialName={documentLabel(doc)}
        steps={presetDialogSteps ?? {}}
        submitLabel={t("common.save")}
        onSubmit={createPreset}
        onClose={() => setPresetDialogSteps(null)}
      />
      <UnsavedChangesDialog
        open={leave.asking}
        onSave={() => {
          if (dirty) save();
          if (shapesDirty) void saveShapes();
          if (vectors.dirty && !vectors.pending) void saveVectors();
          leave.proceed();
        }}
        onDiscard={() => {
          setDraft(doc.editSettings);
          setMode("none");
          discardShapes();
          vectors.discard();
          leave.proceed();
        }}
        onStay={leave.stay}
      />
    </div>
  );
}

interface ViewerProps {
  doc: ArchiveDocument;
  editing: boolean;
  draft: EditSettings;
  mode: GeometryMode;
  onCornersChange: (corners: NonNullable<EditSettings["corners"]>) => void;
  processed: ReturnType<typeof useProcessedPreview>;
  shapes: Shape[];
}

function Viewer({ doc, editing, draft, mode, onCornersChange, processed, shapes }: ViewerProps) {
  const { t } = useTranslation();
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
          shapes={shapes}
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
          {t("document.openPdf")}
        </a>
      </div>
    );
  }
  return (
    <div className="empty-state">
      <FileText size={40} strokeWidth={1.25} />
      <p className="muted">{t("document.noPreview")}</p>
      <a href={assetUrl(doc, "file")} download={doc.originalName} className="btn">
        <Download size={16} />
        {t("document.download")}
      </a>
    </div>
  );
}

interface TextPanelProps {
  doc: ArchiveDocument;
  onRunOcr: (request?: OcrRequest) => void;
  onSave: (text: string) => Promise<unknown>;
}

export function TextPanel({ doc, onRunOcr, onSave }: TextPanelProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const config = useConfig();
  const [text, setText] = useState(doc.ocrText);
  const current = doc.ocrLanguages?.join("+") ?? "";
  const [language, setLanguage] = useState(current);
  const busy = isOcrBusy(doc);

  useEffect(() => setText(doc.ocrText), [doc.ocrText]);
  useEffect(() => setLanguage(current), [current]);

  const languageChanged = language !== current;
  const recognize = () => onRunOcr(languageChanged ? { languages: language ? language.split("+") : null } : {});
  const defaultLanguages = config.ocrLanguages.map(ocrLanguageName).join(" + ");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("textPanel.copied"));
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="text-panel">
      <div className="text-panel__status">
        <span className={`status status--${doc.ocrStatus}`}>
          {busy && <Loader size={14} className="spin" />}
          {ocrStatusLabel(doc.ocrStatus)}
          {doc.ocrStatus === "done" && doc.ocrConfidence !== null && ` · ${t("textPanel.confidence", { value: Math.round(doc.ocrConfidence) })}`}
          {doc.metadata.textSource === "pdf" && ` · ${t("textPanel.fromPdf")}`}
        </span>
        <div className="button-row">
          <button type="button" className="btn btn--sm btn--ghost btn--icon" onClick={copy} disabled={!text} aria-label={t("textPanel.copy")} title={t("textPanel.copy")}>
            <Copy size={16} />
          </button>
          {doc.kind !== "file" && (
            <button type="button" className="btn btn--sm" onClick={recognize} disabled={busy}>
              <ScanText size={16} />
              {languageChanged && language
                ? t("textPanel.recognizeIn", { language: language.split("+").map(ocrLanguageName).join(" + ") })
                : doc.ocrStatus === "none"
                  ? t("textPanel.recognize")
                  : t("textPanel.recognizeAgain")}
            </button>
          )}
        </div>
      </div>
      {doc.kind !== "file" && (
        <div className="text-panel__language">
          <span className="muted small">
            {doc.ocrLanguage ? t("textPanel.language", { language: ocrLanguageName(doc.ocrLanguage) }) : doc.ocrStatus === "done" && doc.ocrText ? t("textPanel.languageUnknown") : ""}
          </span>
          <select
            className="input input--sm text-panel__language-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={busy}
            aria-label={t("textPanel.languageSelect")}
            title={t("textPanel.languageSelect")}
          >
            <option value="">{t("batch.automaticLanguages", { languages: defaultLanguages })}</option>
            {OCR_LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {ocrLanguageName(code)}
              </option>
            ))}
          </select>
        </div>
      )}
      {doc.ocrStatus === "failed" && doc.ocrError && <div className="alert alert--error">{translateServerMessage(doc.ocrError)}</div>}
      {doc.ocrStatus === "done" && doc.ocrRemoved > 0 && (
        <p className="muted small">
          {t("textPanel.removed", { count: doc.ocrRemoved })}{" "}
          <button type="button" className="link-button" onClick={() => onRunOcr({ allText: true })}>
            {t("settings.allText")}
          </button>
        </p>
      )}
      {doc.ocrStatus === "done" && doc.ocrAllText && (
        <p className="muted small">
          {t("textPanel.allTextKept")}{" "}
          <button type="button" className="link-button" onClick={() => onRunOcr({ allText: false })}>
            {t("textPanel.hideUncertain")}
          </button>
        </p>
      )}
      <textarea
        className="textarea text-panel__text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={busy ? t("textPanel.recognizing") : t("textPanel.noText")}
        disabled={busy}
        aria-label={t("textPanel.recognized")}
      />
      <div className="text-panel__actions">
        <button type="button" className="btn btn--sm" onClick={() => setText(doc.ocrText)} disabled={text === doc.ocrText}>
          {t("unsaved.discard")}
        </button>
        <button type="button" className="btn btn--sm btn--primary" onClick={() => onSave(text)} disabled={text === doc.ocrText}>
          {t("textPanel.save")}
        </button>
      </div>
    </div>
  );
}

interface DetailsPanelProps {
  doc: ArchiveDocument;
  onFoldersChange: (folders: string[]) => void;
  onDuplicate: () => Promise<void>;
  onDetach: () => Promise<void>;
  onReimport?: () => Promise<void>;
}

export function DetailsPanel({ doc, onFoldersChange, onDuplicate, onDetach, onReimport }: DetailsPanelProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const rows: [string, string][] = [
    [t("details.fileName"), doc.originalName],
    ...(doc.source ? [[t("details.source"), `${doc.source.name}: ${doc.source.path}`] as [string, string]] : []),
    [t("details.type"), doc.mimeType],
    [t("details.size"), formatBytes(doc.size)],
  ];
  if (doc.width && doc.height) rows.push([t("details.dimensions"), t("details.dimensionsValue", { width: doc.width, height: doc.height })]);
  if (doc.pageCount) rows.push([t("details.pages"), String(doc.pageCount)]);
  rows.push([t("details.uploaded"), formatDateTime(doc.createdAt)], [t("details.modified"), formatDateTime(doc.updatedAt)]);

  const exportPdf = async (quality?: PdfQuality) => {
    setExporting(true);
    try {
      await whenEditsSaved(doc.id);
      const { blob, filename } = await api.exportPdf(doc.id, quality);
      saveBlob(blob, filename);
    } catch (error) {
      toast.error(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="details-panel">
      <div className="button-row">
        <a href={assetUrl(doc, "file")} download={doc.originalName} className="btn btn--sm">
          <Download size={16} />
          {t("details.original")}
        </a>
        {doc.kind === "image" && (
          <PdfButton
            small
            onExport={(quality) => void exportPdf(quality)}
            busy={exporting}
            disabled={exporting || isOcrBusy(doc)}
            title={t("details.pdfTitle")}
          />
        )}
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => void run(onDuplicate)}
          disabled={busy}
          title={t("details.duplicateTitle")}
        >
          <Copy size={16} />
          {t("details.duplicate")}
        </button>
        {doc.copyOf && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => void run(onDetach)}
            disabled={busy}
            title={t("details.detachTitle")}
          >
            <Unlink size={16} />
            {t("details.detach")}
          </button>
        )}
        {doc.source && onReimport && (
          <button type="button" className="btn btn--sm" onClick={() => void run(onReimport)} disabled={busy} title={t("details.reimportTitle")}>
            <RefreshCw size={16} />
            {t("details.reimport")}
          </button>
        )}
      </div>
      <FolderPicker value={doc.folders} onChange={onFoldersChange} />
      <dl className="details">
        {doc.copyOf && (
          <div className="details__row">
            <dt>{t("details.copyOf")}</dt>
            <dd>
              <Link to={`/documents/${doc.copyOf.id}`} className="underline">
                {doc.copyOf.title}
              </Link>
              <span className="muted">{t("details.usesOriginal")}</span>
            </dd>
          </div>
        )}
        {doc.copies.length > 0 && (
          <div className="details__row">
            <dt>{t("details.copies")}</dt>
            <dd>
              <ul className="details__links">
                {doc.copies.map((copy) => (
                  <li key={copy.id}>
                    <Link to={`/documents/${copy.id}`} className="underline">
                      {copy.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
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
