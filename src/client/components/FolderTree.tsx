import { ChevronRight, Folder, FolderOpen, Inbox, Pencil, Plus, Trash, Wand } from "../icons";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { buildFolderTree, type FolderNode, isWithinFolder } from "../../shared/folders";
import { api } from "../api";
import { useFolders } from "../hooks/folders";
import { useJobs } from "../hooks/jobs";
import { useToast } from "../hooks/toast";
import { folderHref, useCurrentFolder } from "../routes";
import { ConfirmDialog } from "./Dialog";

const EXPANDED_KEY = "archivar.expandedFolders";

function readExpandedFolders(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function storeExpanded(path: string, expanded: boolean) {
  const paths = readExpandedFolders();
  if (expanded) paths.add(path);
  else paths.delete(path);
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...paths]));
  } catch {}
}

interface FolderTreeProps {
  onNavigate?: () => void;
}

export function FolderTree({ onNavigate }: FolderTreeProps) {
  const { folders, reload } = useFolders();
  const toast = useToast();
  const active = useCurrentFolder() ?? "";
  const { pathname } = useLocation();
  const { activeCount } = useJobs();
  const tree = useMemo(
    () => buildFolderTree(folders.map((f) => ({ id: f.id, path: f.path, count: f.documentCount + f.stackCount }))),
    [folders],
  );
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) return setCreating(false);
    try {
      await api.createFolder(newPath);
      await reload();
      setNewPath("");
      setCreating(false);
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <nav className="folder-tree" aria-label="Ordner">
      <Link to="/" className={`folder-tree__row ${pathname === "/" ? "is-active" : ""}`} onClick={onNavigate}>
        <span className="folder-tree__toggle" />
        <Inbox size={16} aria-hidden />
        <span className="folder-tree__name">Alle Dokumente</span>
      </Link>
      <Link to="/jobs" className={`folder-tree__row ${pathname === "/jobs" ? "is-active" : ""}`} onClick={onNavigate}>
        <span className="folder-tree__toggle" />
        <Wand size={16} aria-hidden />
        <span className="folder-tree__name">Stapelverarbeitung</span>
        {activeCount > 0 && (
          <span className="folder-tree__count folder-tree__count--busy" title={activeCount === 1 ? "1 Auftrag läuft" : `${activeCount} Aufträge laufen`}>
            {activeCount}
          </span>
        )}
      </Link>

      <div className="folder-tree__heading">
        <h3>Ordner</h3>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          onClick={() => setCreating(true)}
          aria-label="Neuer Ordner"
          title="Neuer Ordner"
        >
          <Plus size={16} />
        </button>
      </div>

      {creating && (
        <form onSubmit={create} className="folder-tree__form">
          <input
            autoFocus
            className="input input--sm"
            placeholder="z.B. wichtig/2026"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onBlur={create}
            onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            aria-label="Name des neuen Ordners"
          />
        </form>
      )}

      {tree.length === 0 && !creating && <p className="folder-tree__empty">Noch keine Ordner</p>}

      <ul className="folder-tree__list" role="tree">
        {tree.map((node) => (
          <FolderTreeNode key={node.path} node={node} active={active} depth={0} onNavigate={onNavigate} />
        ))}
      </ul>
    </nav>
  );
}

interface NodeProps {
  node: FolderNode;
  active: string;
  depth: number;
  onNavigate?: () => void;
}

function FolderTreeNode({ node, active, depth, onNavigate }: NodeProps) {
  const { reload } = useFolders();
  const toast = useToast();
  const [expanded, setExpanded] = useState(
    () => readExpandedFolders().has(node.path) || (active !== node.path && isWithinFolder(active, node.path)),
  );
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.path);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isActive = active === node.path;
  const hasChildren = node.children.length > 0;

  const rename = async (e?: FormEvent) => {
    e?.preventDefault();
    setRenaming(false);
    if (name.trim() === node.path || !name.trim()) return setName(node.path);
    try {
      const id = node.id ?? (await api.createFolder(node.path)).id;
      await api.renameFolder(id, name);
      await reload();
    } catch (error) {
      toast.error(error);
      setName(node.path);
    }
  };

  const remove = async () => {
    try {
      const id = node.id ?? (await api.createFolder(node.path)).id;
      await api.deleteFolder(id);
      await reload();
    } catch (error) {
      toast.error(error);
    }
  };

  const Icon = expanded && hasChildren ? FolderOpen : Folder;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? expanded : undefined} aria-selected={isActive}>
      {renaming ? (
        <form onSubmit={rename} className="folder-tree__form" style={{ paddingLeft: `calc(${depth} * var(--space-4))` }}>
          <input
            autoFocus
            className="input input--sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => rename()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setName(node.path);
                setRenaming(false);
              }
            }}
            aria-label="Ordner umbenennen"
          />
        </form>
      ) : (
        <div className={`folder-tree__row ${isActive ? "is-active" : ""}`} style={{ paddingLeft: `calc(${depth} * var(--space-4) + var(--space-2))` }}>
          <button
            type="button"
            className="folder-tree__toggle"
            onClick={() => {
              storeExpanded(node.path, !expanded);
              setExpanded(!expanded);
            }}
            aria-label={expanded ? "Zuklappen" : "Aufklappen"}
            hidden={!hasChildren}
          >
            <ChevronRight size={14} className={expanded ? "is-rotated" : ""} />
          </button>
          <Link to={folderHref(node.path)} className="folder-tree__link" onClick={onNavigate}>
            <Icon size={16} aria-hidden />
            <span className="folder-tree__name">{node.name}</span>
            {node.count > 0 && <span className="folder-tree__count">{node.count}</span>}
          </Link>
          <span className="folder-tree__actions">
            <button type="button" className="btn btn--ghost btn--icon btn--xs" onClick={() => setRenaming(true)} aria-label={`${node.path} umbenennen`}>
              <Pencil size={13} />
            </button>
            <button type="button" className="btn btn--ghost btn--icon btn--xs" onClick={() => setConfirmDelete(true)} aria-label={`${node.path} löschen`}>
              <Trash size={13} />
            </button>
          </span>
        </div>
      )}
      {hasChildren && expanded && (
        <ul role="group" className="folder-tree__list">
          {node.children.map((child) => (
            <FolderTreeNode key={child.path} node={child} active={active} depth={depth + 1} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Ordner löschen"
        message={
          <>
            Ordner <strong>{node.path}</strong> und alle Unterordner entfernen? Die Dokumente selbst bleiben erhalten.
          </>
        }
        confirmLabel="Löschen"
        danger
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </li>
  );
}
