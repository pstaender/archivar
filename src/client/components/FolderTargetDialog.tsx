import { Folder as FolderIcon, Plus } from "../icons";
import { type CSSProperties, type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { buildFolderTree, type FolderNode, normalizeFolderPath } from "../../shared/folders";
import { useFolders } from "../hooks/folders";
import { Dialog } from "./Dialog";
import { useTranslation } from "react-i18next";

interface FolderTargetDialogProps {
  open: boolean;
  /** Folder the selection is moved out of; null in the overview. */
  from: string | null;
  working: boolean;
  onMove: (targets: string[]) => void;
  onAdd: (targets: string[]) => void;
  onClose: () => void;
}

interface Row {
  path: string;
  name: string;
  depth: number;
  isNew: boolean;
}

function flatten(nodes: FolderNode[], created: Set<string>, depth = 0): Row[] {
  return nodes.flatMap((node) => [
    { path: node.path, name: node.name, depth, isNew: created.has(node.path) },
    ...flatten(node.children, created, depth + 1),
  ]);
}

export function FolderTargetDialog({ open, from, working, onMove, onAdd, onClose }: FolderTargetDialogProps) {
  const { folders } = useFolders();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const inputId = useId();

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setCreated([]);
    setInput("");
  }, [open]);

  const rows = useMemo(() => {
    const known = new Set(folders.map((f) => f.path));
    const extra = created.filter((path) => !known.has(path)).map((path) => ({ id: 0, path, count: 0 }));
    const tree = buildFolderTree([...folders.map((f) => ({ id: f.id, path: f.path, count: 0 })), ...extra]);
    return flatten(tree, new Set(extra.map((f) => f.path)));
  }, [folders, created]);

  const toggle = (path: string) =>
    setSelected((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path].sort()));

  const create = (e: FormEvent) => {
    e.preventDefault();
    const path = normalizeFolderPath(input);
    if (!path) return;
    setCreated((current) => (current.includes(path) ? current : [...current, path]));
    setSelected((current) => (current.includes(path) ? current : [...current, path].sort()));
    setInput("");
  };

  return (
    <Dialog
      open={open}
      title={t("folderTarget.title")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={() => onAdd(selected)} disabled={working || selected.length === 0}>
            {t("folderTarget.add")}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => onMove(selected)} disabled={working || selected.length === 0}>
            {t("folderTarget.move")}
          </button>
        </>
      }
    >
      {rows.length > 0 ? (
        <ul className="folder-choices" aria-label={t("folderTarget.folders")}>
          {rows.map((row) => (
            <li key={row.path}>
              <label className="folder-choice" style={{ "--depth": row.depth } as CSSProperties} title={row.path}>
                <input type="checkbox" checked={selected.includes(row.path)} onChange={() => toggle(row.path)} aria-label={row.path} />
                <FolderIcon size={15} aria-hidden />
                <span className="folder-choice__name">{row.name}</span>
                {row.isNew && <span className="folder-choice__badge">{t("folderTarget.new")}</span>}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{t("folderTarget.none")}</p>
      )}
      <form className="folder-choices__create" onSubmit={create}>
        <label htmlFor={inputId} className="visually-hidden">
          {t("folderTarget.newFolder")}
        </label>
        <input
          id={inputId}
          className="input input--sm"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("folderTarget.newPlaceholder")}
        />
        <button type="submit" className="btn btn--sm" disabled={!normalizeFolderPath(input)}>
          <Plus size={16} />
          {t("folderTarget.create")}
        </button>
      </form>
      <p className="muted small">
        {from
          ? t("folderTarget.moveFromHint", { folder: from })
          : t("folderTarget.moveHint")}
      </p>
    </Dialog>
  );
}
