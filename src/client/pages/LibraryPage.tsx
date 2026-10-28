import {
  Folder,
  FolderMinus,
  FolderPlus,
  Layers,
  RatioLandscape,
  RatioPortrait,
  RatioSquare,
  SmartStackIcon,
  SquareCheck,
  Trash,
  Upload,
  Wand,
  X,
} from "../icons";
import type { PdfQuality } from "../../shared/settings";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { moveToFolders } from "../../shared/folders";
import { LIBRARY_SORTS, type LibraryItem, type LibrarySort } from "../../shared/types";
import { api } from "../api";
import { BatchDialog } from "../components/BatchDialog";
import { ConfirmDialog, Dialog } from "../components/Dialog";
import { PdfButton } from "../components/PdfButton";
import { FolderTargetDialog } from "../components/FolderTargetDialog";
import { ItemCard, itemKey, SmartStackCard } from "../components/ItemCard";
import { SortableGrid } from "../components/SortableGrid";
import { useFolders } from "../hooks/folders";
import { useToast } from "../hooks/toast";
import { useRefreshOnEditSave, whenEditsSaved } from "../editSaves";
import { useRefreshOnJobProgress } from "../hooks/jobs";
import { useRefreshOnUpload, useUpload } from "../hooks/upload";
import { usePolling } from "../hooks/usePolling";
import { useResource } from "../hooks/useResource";
import { itemFromHash, rememberDocumentOrder, rememberLibraryLocation } from "../documentOrder";
import { useScrollToHashItem } from "../hooks/scrollToItem";
import { type DisplayItem, groupSmartStacks, type SmartStack, smartStackKey } from "../smartStacks";
import { saveBlob } from "../download";
import { documentLabel, isOcrBusy } from "../format";
import { folderHref, useCurrentFolder } from "../routes";
import { useTranslation } from "react-i18next";

const POLL_INTERVAL = 2500;
// Folders and the overview keep separate choices, so folders open in their own arrangement by default.
const SORT_KEYS = { overview: "archivar.librarySort", folder: "archivar.folderSort" } as const;
const DEFAULT_SORTS: Record<keyof typeof SORT_KEYS, LibrarySort> = { overview: "updated", folder: "custom" };
const FOLDER_SORTS: LibrarySort[] = ["custom", ...LIBRARY_SORTS.filter((value) => value !== "custom")];
const OVERVIEW_SORTS = LIBRARY_SORTS.filter((value) => value !== "custom");

function readSort(scope: keyof typeof SORT_KEYS): LibrarySort {
  const allowed = scope === "folder" ? FOLDER_SORTS : OVERVIEW_SORTS;
  try {
    const stored = localStorage.getItem(SORT_KEYS[scope]);
    return allowed.includes(stored as LibrarySort) ? (stored as LibrarySort) : DEFAULT_SORTS[scope];
  } catch {
    return DEFAULT_SORTS[scope];
  }
}

function useStoredSort(scope: keyof typeof SORT_KEYS): [LibrarySort, (sort: LibrarySort) => void] {
  const [sorts, setSorts] = useState(() => ({ overview: readSort("overview"), folder: readSort("folder") }));
  const update = (next: LibrarySort) => {
    setSorts((current) => ({ ...current, [scope]: next }));
    try {
      localStorage.setItem(SORT_KEYS[scope], next);
    } catch {}
  };
  return [sorts[scope], update];
}

export type CardShape = "portrait" | "landscape" | "square";

const CARD_SHAPE_KEY = "archivar.cardShape";

const CARD_SHAPES: { value: CardShape; Icon: typeof RatioPortrait }[] = [
  { value: "portrait", Icon: RatioPortrait },
  { value: "landscape", Icon: RatioLandscape },
  { value: "square", Icon: RatioSquare },
];

/** The shape of the cards' thumbnails, the same for the overview and all folders. */
function useCardShape(): [CardShape, (shape: CardShape) => void] {
  const [shape, setShape] = useState<CardShape>(() => {
    try {
      const stored = localStorage.getItem(CARD_SHAPE_KEY);
      return CARD_SHAPES.some((s) => s.value === stored) ? (stored as CardShape) : "portrait";
    } catch {
      return "portrait";
    }
  });
  const update = (next: CardShape) => {
    setShape(next);
    try {
      localStorage.setItem(CARD_SHAPE_KEY, next);
    } catch {}
  };
  return [shape, update];
}

const SMART_STACKS_KEY = "archivar.smartStacks";
const SHOW_FILED_KEY = "archivar.showFiled";

function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });
  const update = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {}
  };
  return [on, update];
}

const displayKey = (item: DisplayItem) => (item.type === "smart" ? smartStackKey(item) : itemKey(item));
const displayTitle = (item: DisplayItem) => (item.type === "smart" ? item.title : itemTitle(item));
const sameIds = (stack: SmartStack, ids: number[]) => stack.documents.length === ids.length && stack.documents.every((doc) => ids.includes(doc.id));

const itemRef = (item: LibraryItem) => ({ type: item.type, id: item.type === "stack" ? item.stack.id : item.document.id });
const itemFolders = (item: LibraryItem) => (item.type === "stack" ? item.stack.folders : item.document.folders);
const itemTitle = (item: LibraryItem) => (item.type === "stack" ? item.stack.title : documentLabel(item.document));
// A smart stack stands for its documents, e.g. to turn them into a real stack.
const libraryItems = (item: DisplayItem): LibraryItem[] =>
  item.type === "smart" ? item.documents.map((document) => ({ type: "document" as const, document })) : [item];

/** Adds the items to the folders, or moves them there out of `from` and its sub-folders (all folders when null). */
async function fileInFolders(items: LibraryItem[], targets: string[], move: boolean, from: string | null): Promise<void> {
  const next = (current: string[]) => (move ? moveToFolders(current, from, targets) : [...new Set([...current, ...targets])].sort());
  for (const item of items) {
    if (item.type === "document") await api.updateDocument(item.document.id, { folders: next(item.document.folders) });
    else await api.updateStack(item.stack.id, { folders: next(item.stack.folders) });
  }
}

export function LibraryPage() {
  const [params] = useSearchParams();
  const folder = useCurrentFolder() ?? undefined;
  const q = params.get("q") ?? undefined;
  const legacyFolder = params.get("folder");
  const toast = useToast();
  const { t } = useTranslation();
  const [sort, setSort] = useStoredSort(folder ? "folder" : "overview");
  const [cardShape, setCardShape] = useCardShape();
  const [smartStacks, setSmartStacks] = useStoredFlag(SMART_STACKS_KEY);
  const [showFiled, setShowFiled] = useStoredFlag(SHOW_FILED_KEY);
  const location = useLocation();
  // A smart stack opened from the library: only its documents, given in the URL as it is not stored anywhere.
  const smartParam = params.get("smart");
  const smartIds = useMemo(() => (smartParam ? smartParam.split("-").map(Number).filter(Number.isInteger) : null), [smartParam]);
  const library = useResource(() => api.library({ folder, q, sort }), [folder, q, sort]);
  useRefreshOnUpload(library.refresh);
  useRefreshOnEditSave(library.refresh);
  useRefreshOnJobProgress(library.refresh);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // The overview leaves out what is already filed in a folder, unless asked to show everything; searches find all.
  const hidingFiled = !folder && !q && !showFiled;
  const loaded = library.data ?? [];
  const allItems = useMemo(() => (hidingFiled ? loaded.filter((item) => itemFolders(item).length === 0) : loaded), [hidingFiled, library.data]);
  const hiddenCount = loaded.length - allItems.length;
  const items = smartIds
    ? smartIds.flatMap((id) => allItems.filter((item) => item.type === "document" && item.document.id === id))
    : allItems;
  const grouping = smartStacks && sort !== "custom" && !smartIds;
  const displayItems: DisplayItem[] = useMemo(() => (grouping ? groupSmartStacks(items) : items), [grouping, allItems, smartIds]);

  useEffect(() => setSelected(new Set()), [folder, q, grouping, smartParam, hidingFiled]);

  useEffect(() => {
    if (library.data) rememberDocumentOrder(items.flatMap((item) => (item.type === "document" ? [item.document.id] : [])));
  }, [allItems, smartParam]);
  useEffect(() => rememberLibraryLocation(location.pathname + location.search), [location.pathname, location.search]);
  // Coming back from a document or stack: its card, or the smart stack holding the document.
  useScrollToHashItem(Boolean(library.data), (hash) => {
    const target = itemFromHash(hash);
    if (!target) return null;
    const item = displayItems.find((item) =>
      item.type === "smart"
        ? target.type === "document" && item.documents.some((doc) => doc.id === target.id)
        : item.type === target.type && (item.type === "stack" ? item.stack.id : item.document.id) === target.id,
    );
    return item ? document.querySelector(`[data-item-key="${displayKey(item)}"]`) : null;
  });
  const busy = items.some((item) => item.type === "document" && isOcrBusy(item.document));

  usePolling(busy, library.refresh, POLL_INTERVAL);

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedItems: LibraryItem[] = displayItems.flatMap((item) => (selected.has(displayKey(item)) ? libraryItems(item) : []));
  // Dragging a selected card takes the whole selection along.
  const draggedItems = (item: DisplayItem) => (selected.has(displayKey(item)) ? selectedItems : libraryItems(item));
  const [folderDrop, setFolderDrop] = useState<{ items: LibraryItem[]; folder: string } | null>(null);
  const smartHref = (stack: SmartStack) => {
    const next = new URLSearchParams(params);
    next.set("smart", stack.documents.map((doc) => doc.id).join("-"));
    return `${location.pathname}?${next}`;
  };
  const withoutSmart = () => {
    const next = new URLSearchParams(params);
    next.delete("smart");
    const search = next.toString();
    return search ? `${location.pathname}?${search}` : location.pathname;
  };
  const openedSmartStack = smartIds ? groupSmartStacks(allItems).find((item): item is SmartStack => item.type === "smart" && sameIds(item, smartIds)) : undefined;

  const reorder = (next: LibraryItem[]) => {
    if (!folder) return;
    library.setData(next);
    api.saveFolderOrder(folder, next.map(itemRef)).catch((error) => {
      toast.error(error);
      void library.refresh();
    });
  };

  if (legacyFolder) {
    const rest = new URLSearchParams(params);
    rest.delete("folder");
    return <Navigate to={folderHref(legacyFolder, rest.toString())} replace />;
  }

  const listTitle = q ? t("library.search", { q }) : folder ? folder.split("/").join(" / ") : t("library.allDocuments");
  const title = smartIds ? (openedSmartStack?.title ?? t("library.smartStack")) : listTitle;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{title}</h1>
          {!library.loading && smartIds && (
            <p className="muted small">
              {t("library.smartStack")} · {t("library.documents", { count: items.length })} ·{" "}
              <Link to={withoutSmart()} className="underline">
                {t("library.backTo", { title: listTitle })}
              </Link>
            </p>
          )}
          {!library.loading && !smartIds && (
            <p className="muted small">
              {t("library.entries", { count: displayItems.length })}
              {hiddenCount > 0 && ` · ${t("library.hiddenInFolders", { count: hiddenCount })}`}
              {sort === "custom" && items.length > 1 && ` · ${t("library.dragToArrange")}`}
            </p>
          )}
        </div>
        <div className="library-controls">
          {!smartIds && !folder && !q && (
            <button
              type="button"
              className={`btn btn--sm btn--icon ${showFiled ? "is-active" : ""}`}
              aria-pressed={showFiled}
              aria-label={t("library.showFiled")}
              onClick={() => setShowFiled(!showFiled)}
              title={showFiled ? t("library.showingFiled") : t("library.hidingFiled")}
            >
              <Folder size={18} />
            </button>
          )}
          {!smartIds && (
            <button
              type="button"
              className={`btn btn--sm btn--icon ${grouping ? "is-active" : ""}`}
              aria-pressed={grouping}
              aria-label={t("library.smartStacks")}
              disabled={sort === "custom"}
              onClick={() => setSmartStacks(!smartStacks)}
              title={
                sort === "custom"
                  ? t("library.smartStacksCustom")
                  : t("library.smartStacksHint")
              }
            >
              <SmartStackIcon size={18} />
            </button>
          )}
          <div className="segmented segmented--icons" role="radiogroup" aria-label={t("library.cardShape")}>
            {CARD_SHAPES.map(({ value, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={cardShape === value}
                aria-label={t(`library.cardShapes.${value}`)}
                title={t(`library.cardShapes.${value}`)}
                className={cardShape === value ? "is-active" : ""}
                onClick={() => setCardShape(value)}
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
          <select
            className="input input--sm library-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            aria-label={t("library.sort")}
            title={t("library.sort")}
          >
            {(folder ? FOLDER_SORTS : OVERVIEW_SORTS).map((value) => (
              <option key={value} value={value}>
                {t(`library.sorts.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </header>

      {library.error && <div className="alert alert--error">{library.error.message}</div>}

      {!library.loading && items.length === 0 && !library.error && <EmptyLibrary filtered={Boolean(folder || q || smartIds)} allFiled={hiddenCount > 0} />}

      <div className="library" data-card-shape={cardShape}>
        <SortableGrid<DisplayItem>
          items={displayItems}
          itemKey={displayKey}
          itemLabel={displayTitle}
          busy={library.loading}
          onReorder={sort === "custom" && !smartIds ? (next) => reorder(next as LibraryItem[]) : undefined}
          onFolderDrop={(item, target) => setFolderDrop({ items: draggedItems(item), folder: target })}
          dragCount={(item) => draggedItems(item).length}
          renderItem={(item) =>
            item.type === "smart" ? (
              <SmartStackCard
                stack={item}
                href={smartHref(item)}
                selected={selected.has(displayKey(item))}
                selectionMode={selected.size > 0}
                onToggle={() => toggle(displayKey(item))}
              />
            ) : (
              <ItemCard
                item={item}
                selected={selected.has(itemKey(item))}
                selectionMode={selected.size > 0}
                onToggle={() => toggle(itemKey(item))}
              />
            )
          }
        />
      </div>

      {selectedItems.length > 0 && (
        <SelectionBar
          items={selectedItems}
          allSelected={displayItems.every((item) => selected.has(displayKey(item)))}
          onSelectAll={() => setSelected(new Set(displayItems.map(displayKey)))}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            void library.reload();
          }}
        />
      )}

      <FolderDropDialog
        drop={folderDrop}
        onClose={() => setFolderDrop(null)}
        onDone={() => {
          setFolderDrop(null);
          setSelected(new Set());
          void library.reload();
        }}
      />
    </div>
  );
}

/** Asks before filing cards dropped onto a folder in the sidebar. */
function FolderDropDialog({ drop, onClose, onDone }: { drop: { items: LibraryItem[]; folder: string } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { t } = useTranslation();
  const { reload: reloadFolders } = useFolders();
  const from = useCurrentFolder();
  const [working, setWorking] = useState(false);
  const [shown, setShown] = useState(drop);
  // Keeps the text while the dialog closes.
  if (drop && drop !== shown) setShown(drop);

  const file = async (move: boolean) => {
    if (!drop) return;
    setWorking(true);
    try {
      await fileInFolders(drop.items, [drop.folder], move, from);
      await reloadFolders();
      const where = t("quoted", { text: drop.folder });
      toast.success(move ? t("selection.movedTo", { where }) : t("selection.addedTo", { where }));
      onDone();
    } catch (error) {
      toast.error(error);
    } finally {
      setWorking(false);
    }
  };

  const items = shown?.items ?? [];
  return (
    <Dialog
      open={drop !== null}
      title={t("dragDrop.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => void file(false)} disabled={working}>
            {t("folderTarget.add")}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => void file(true)} disabled={working}>
            {t("folderTarget.move")}
          </button>
        </>
      }
    >
      <p>
        {items.length === 1
          ? t("dragDrop.questionItem", { title: itemTitle(items[0]!), folder: shown?.folder })
          : t("dragDrop.questionItems", { count: items.length, folder: shown?.folder })}
      </p>
      <p className="muted small">{from ? t("dragDrop.moveFromHint", { folder: from }) : t("dragDrop.moveHint")}</p>
    </Dialog>
  );
}

function EmptyLibrary({ filtered, allFiled }: { filtered: boolean; allFiled: boolean }) {
  const { uploadToCurrentTarget } = useUpload();
  const { t } = useTranslation();
  if (allFiled) {
    return (
      <div className="empty-state">
        <p className="muted">{t("library.allFiled")}</p>
      </div>
    );
  }
  if (filtered) {
    return (
      <div className="empty-state">
        <p className="muted">{t("library.noMatches")}</p>
      </div>
    );
  }
  return (
    <label className="empty-state empty-state--upload">
      <Upload size={28} strokeWidth={1.5} />
      <h2>{t("library.emptyTitle")}</h2>
      <p className="muted">{t("library.emptyText")}</p>
      <span className="btn btn--primary">{t("library.chooseFiles")}</span>
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
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}

export function SelectionBar({ items, allSelected, onSelectAll, onClear, onDone }: SelectionBarProps) {
  const toast = useToast();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reload: reloadFolders } = useFolders();
  const from = useCurrentFolder();
  const [folderDialog, setFolderDialog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [batchDialog, setBatchDialog] = useState(false);
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
      toast.success(t("selection.stackCreated", { title: created.title }));
      onDone();
      navigate(`/stacks/${created.id}`);
    });

  const fileFolders = (targets: string[], move: boolean) =>
    run(async () => {
      await fileInFolders(items, targets, move, from);
      await reloadFolders();
      const where = targets.length === 1 ? t("quoted", { text: targets[0] }) : t("selection.folderCount", { count: targets.length });
      toast.success(move ? t("selection.movedTo", { where }) : t("selection.addedTo", { where }));
      setFolderDialog(false);
      onDone();
    });

  const removeFromFolder = (folder: string) =>
    run(async () => {
      for (const item of items) {
        const current = item.type === "document" ? item.document.folders : item.stack.folders;
        const next = moveToFolders(current, folder, []);
        if (next.length === current.length) continue;
        if (item.type === "document") await api.updateDocument(item.document.id, { folders: next });
        else await api.updateStack(item.stack.id, { folders: next });
      }
      await reloadFolders();
      toast.success(t("selection.removedFrom", { folder }));
      onDone();
    });

  const exportPdf = (quality?: PdfQuality) =>
    run(async () => {
      setExporting(true);
      try {
        const title = items.length === 1 ? (items[0]!.type === "stack" ? items[0]!.stack.title : documentLabel(items[0]!.document)) : undefined;
        await whenEditsSaved();
        const { blob, filename } = await api.exportCombinedPdf(documentIds, title, quality);
        saveBlob(blob, filename);
      } finally {
        setExporting(false);
      }
    });

  const remove = () =>
    run(async () => {
      for (const id of documentIds) await api.deleteDocument(id);
      await reloadFolders();
      toast.success(t("selection.deleted", { count: documentIds.length }));
      onDone();
    });

  return (
    <div className="selection-bar" role="toolbar" aria-label={t("selection.label")}>
      <button type="button" className="btn btn--ghost btn--icon" onClick={onClear} aria-label={t("selection.clear")}>
        <X size={18} />
      </button>
      <span className="selection-bar__count">{t("selection.count", { count: items.length })}</span>
      <div className="selection-bar__actions">
        <button type="button" className="btn" onClick={onSelectAll} disabled={working || allSelected} title={t("selection.selectAll")}>
          <SquareCheck size={16} />
          <span className="hide-mobile">{t("selection.selectAll")}</span>
        </button>
        <button type="button" className="btn" onClick={() => setBatchDialog(true)} disabled={working} title={t("selection.batchTitle")}>
          <Wand size={16} />
          <span className="hide-mobile">{t("selection.batch")}</span>
        </button>
        <button type="button" className="btn" onClick={stack} disabled={working || documentIds.length === 0}>
          <Layers size={16} />
          <span className="hide-mobile">{t("selection.stack")}</span>
        </button>
        <button type="button" className="btn" onClick={() => setFolderDialog(true)} disabled={working} title={t("selection.folderTitle")}>
          <FolderPlus size={16} />
          <span className="hide-mobile">{t("selection.folder")}</span>
        </button>
        {from && (
          <button
            type="button"
            className="btn"
            onClick={() => removeFromFolder(from)}
            disabled={working}
            aria-label={t("selection.removeFrom", { folder: from })}
            title={t("selection.removeFrom", { folder: from })}
          >
            <FolderMinus size={16} />
            <span className="hide-mobile" aria-hidden>
              {t("selection.folder")}
            </span>
          </button>
        )}
        <PdfButton
          up
          onExport={exportPdf}
          busy={exporting}
          disabled={working || !exportable}
          title={t("selection.pdfTitle")}
          labelClassName="hide-mobile"
        />
        <button type="button" className="btn btn--danger-ghost" onClick={() => setConfirmDelete(true)} disabled={working}>
          <Trash size={16} />
          <span className="hide-mobile">{t("common.delete")}</span>
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

      <BatchDialog open={batchDialog} documentIds={documentIds} onClose={() => setBatchDialog(false)} onStarted={onDone} />

      <ConfirmDialog
        open={confirmDelete}
        title={t("selection.deleteTitle")}
        message={t("selection.deleteText", { count: documentIds.length })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
