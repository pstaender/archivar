export interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
  id: number | null;
  count: number;
}

export function normalizeFolderPath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("/");
}

export function isWithinFolder(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

export function parentPaths(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function buildFolderTree(folders: { id: number; path: string; count: number }[]): FolderNode[] {
  const root: FolderNode = { name: "", path: "", children: [], id: null, count: 0 };
  const sorted = [...folders].sort((a, b) => a.path.localeCompare(b.path));
  for (const folder of sorted) {
    let node = root;
    const parts = folder.path.split("/");
    parts.forEach((name, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === name);
      if (!child) {
        child = { name, path, children: [], id: null, count: 0 };
        node.children.push(child);
      }
      node = child;
    });
    node.id = folder.id;
    node.count = folder.count;
  }
  return root.children;
}
