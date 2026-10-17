import {
  Download,
  FolderMinus,
  FolderPlus,
  Layers,
  Loader,
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
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { moveToFolders } from "../../shared/folders";
import { LIBRARY_SORTS, type LibraryItem, type LibrarySort } from "../../shared/types";
import { api } from "../api";
import { BatchDialog } from "../components/BatchDialog";
import { ConfirmDialog } from "../components/Dialog";
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
import { rememberDocumentOrder } from "../documentOrder";
import { type DisplayItem, groupSmartStacks, type SmartStack, smartStackKey } from "../smartStacks";
import { saveBlob } from "../download";
import { documentLabel, isOcrBusy } from "../format";
import { folderHref, useCurrentFolder } from "../routes";

const POLL_INTERVAL = 2500;
// Folders and the overview keep separate choices, so folders open in their own arrangement by default.
const SORT_KEYS = { overview: "archivar.librarySort", folder: "archivar.folderSort" } as const;
const DEFAULT_SORTS: Record<keyof typeof SORT_KEYS, LibrarySort> = { overview: "updated", folder: "custom" };
const FOLDER_SORTS: LibrarySort[] = ["custom", ...LIBRARY_SORTS.filter((value) => value !== "custom")];
const OVERVIEW_SORTS = LIBRARY_SORTS.filter((value) => value !== "custom");

const SORT_LABELS: Record<LibrarySort, string> = {
  updated: "Zuletzt geändert",
  "created-desc": "Hochgeladen, neueste zuerst",
  "created-asc": "Hochgeladen, älteste zuerst",
  "title-asc": "Name A–Z",
  "title-desc": "Name Z–A",
  custom: "Eigene Reihenfolge",
};

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

const CARD_SHAPES: { value: CardShape; label: string; Icon: typeof RatioPortrait }[] = [
  { value: "portrait", label: "Hochformat", Icon: RatioPortrait },
  { value: "landscape", label: "Querformat", Icon: RatioLandscape },
  { value: "square", label: "Quadratisch", Icon: RatioSquare },
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

function useSmartStacksSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SMART_STACKS_KEY) === "true";
    } catch {
      return false;
    }
  });
  const update = (next: boolean) => {
    setOn(next);
    try {
      localStorage.setItem(SMART_STACKS_KEY, String(next));
    } catch {}
  };
  return [on, update];
}

const displayKey = (item: DisplayItem) => (item.type === "smart" ? smartStackKey(item) : itemKey(item));
const displayTitle = (item: DisplayItem) => (item.type === "smart" ? item.title : itemTitle(item));
const sameIds = (stack: SmartStack, ids: number[]) => stack.documents.length === ids.length && stack.documents.every((doc) => ids.includes(doc.id));

const itemRef = (item: LibraryItem) => ({ type: item.type, id: item.type === "stack" ? item.stack.id : item.document.id });
const itemTitle = (item: LibraryItem) => (item.type === "stack" ? item.stack.title : documentLabel(item.document));

export function LibraryPage() {
  const [params] = useSearchParams();
  const folder = useCurrentFolder() ?? undefined;
  const q = params.get("q") ?? undefined;
  const legacyFolder = params.get("folder");
  const toast = useToast();
  const [sort, setSort] = useStoredSort(folder ? "folder" : "overview");
  const [cardShape, setCardShape] = useCardShape();
  const [smartStacks, setSmartStacks] = useSmartStacksSetting();
  const location = useLocation();
  // A smart stack opened from the library: only its documents, given in the URL as it is not stored anywhere.
  const smartParam = params.get("smart");
  const smartIds = useMemo(() => (smartParam ? smartParam.split("-").map(Number).filter(Number.isInteger) : null), [smartParam]);
  const library = useResource(() => api.library({ folder, q, sort }), [folder, q, sort]);
  useRefreshOnUpload(library.refresh);
  useRefreshOnEditSave(library.refresh);
  useRefreshOnJobProgress(library.refresh);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allItems = library.data ?? [];
  const items = smartIds
    ? smartIds.flatMap((id) => allItems.filter((item) => item.type === "document" && item.document.id === id))
    : allItems;
  const grouping = smartStacks && sort !== "custom" && !smartIds;
  const displayItems: DisplayItem[] = useMemo(() => (grouping ? groupSmartStacks(items) : items), [grouping, library.data, smartIds]);

  useEffect(() => setSelected(new Set()), [folder, q, grouping, smartParam]);

  useEffect(() => {
    if (library.data) rememberDocumentOrder(items.flatMap((item) => (item.type === "document" ? [item.document.id] : [])));
  }, [library.data, smartParam]);
  const busy = items.some((item) => item.type === "document" && isOcrBusy(item.document));

  usePolling(busy, library.refresh, POLL_INTERVAL);

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // A selected smart stack stands for its documents, e.g. to turn them into a real stack.
  const selectedItems: LibraryItem[] = displayItems.flatMap((item) =>
    !selected.has(displayKey(item)) ? [] : item.type === "smart" ? item.documents.map((document) => ({ type: "document" as const, document })) : [item],
  );
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

  const listTitle = q ? `Suche „${q}“` : folder ? folder.split("/").join(" / ") : "Alle Dokumente";
  const title = smartIds ? (openedSmartStack?.title ?? "Smarter Stapel") : listTitle;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{title}</h1>
          {!library.loading && smartIds && (
            <p className="muted small">
              Smarter Stapel · {items.length === 1 ? "1 Dokument" : `${items.length} Dokumente`} ·{" "}
              <Link to={withoutSmart()} className="underline">
                Zurück zu „{listTitle}“
              </Link>
            </p>
          )}
          {!library.loading && !smartIds && (
            <p className="muted small">
              {displayItems.length === 1 ? "1 Eintrag" : `${displayItems.length} Einträge`}
              {sort === "custom" && items.length > 1 && " · Karten ziehen, um sie anzuordnen"}
            </p>
          )}
        </div>
        <div className="library-controls">
          {!smartIds && (
            <button
              type="button"
              className={`btn btn--sm btn--icon ${grouping ? "is-active" : ""}`}
              aria-pressed={grouping}
              aria-label="Smarte Stapel"
              disabled={sort === "custom"}
              onClick={() => setSmartStacks(!smartStacks)}
              title={
                sort === "custom"
                  ? "Nicht bei eigener Reihenfolge"
                  : "Smarte Stapel: fasst Dateien zusammen, die nach Name oder Uploadzeit zusammengehören – nur in der Ansicht, nichts wird gespeichert"
              }
            >
              <SmartStackIcon size={18} />
            </button>
          )}
          <div className="segmented segmented--icons" role="radiogroup" aria-label="Kartenformat">
            {CARD_SHAPES.map(({ value, label, Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={cardShape === value}
                aria-label={label}
                title={label}
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
            aria-label="Sortierung"
            title="Sortierung"
          >
            {(folder ? FOLDER_SORTS : OVERVIEW_SORTS).map((value) => (
              <option key={value} value={value}>
                {SORT_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </header>

      {library.error && <div className="alert alert--error">{library.error.message}</div>}

      {!library.loading && items.length === 0 && !library.error && <EmptyLibrary filtered={Boolean(folder || q || smartIds)} />}

      <div className="library" data-card-shape={cardShape}>
        <SortableGrid<DisplayItem>
          items={displayItems}
          itemKey={displayKey}
          itemLabel={displayTitle}
          busy={library.loading}
          onReorder={sort === "custom" && !smartIds ? (next) => reorder(next as LibraryItem[]) : undefined}
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
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}

export function SelectionBar({ items, allSelected, onSelectAll, onClear, onDone }: SelectionBarProps) {
  const toast = useToast();
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
      toast.success(`Aus „${folder}“ entfernt`);
      onDone();
    });

  const exportPdf = () =>
    run(async () => {
      setExporting(true);
      try {
        const title = items.length === 1 ? (items[0]!.type === "stack" ? items[0]!.stack.title : documentLabel(items[0]!.document)) : undefined;
        await whenEditsSaved();
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
        <button type="button" className="btn" onClick={onSelectAll} disabled={working || allSelected} title="Alle markieren">
          <SquareCheck size={16} />
          <span className="hide-mobile">Alle markieren</span>
        </button>
        <button type="button" className="btn" onClick={() => setBatchDialog(true)} disabled={working} title="Bildeinstellung und Texterkennung auf die Auswahl anwenden">
          <Wand size={16} />
          <span className="hide-mobile">Stapelverarbeitung</span>
        </button>
        <button type="button" className="btn" onClick={stack} disabled={working || documentIds.length === 0}>
          <Layers size={16} />
          <span className="hide-mobile">Stapeln</span>
        </button>
        <button type="button" className="btn" onClick={() => setFolderDialog(true)} disabled={working} title="In Ordner ablegen">
          <FolderPlus size={16} />
          <span className="hide-mobile">Ordner</span>
        </button>
        {from && (
          <button
            type="button"
            className="btn"
            onClick={() => removeFromFolder(from)}
            disabled={working}
            aria-label={`Aus „${from}“ entfernen`}
            title={`Aus „${from}“ entfernen`}
          >
            <FolderMinus size={16} />
            <span className="hide-mobile" aria-hidden>
              Ordner
            </span>
          </button>
        )}
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

      <BatchDialog open={batchDialog} documentIds={documentIds} onClose={() => setBatchDialog(false)} onStarted={onDone} />

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
