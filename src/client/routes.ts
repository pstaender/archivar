import { useLocation } from "react-router";

const FOLDER_PREFIX = "/folders/";

export function folderHref(path: string, search = ""): string {
  return FOLDER_PREFIX + path.split("/").map(encodeURIComponent).join("/") + (search ? `?${search}` : "");
}

export function folderFromPathname(pathname: string): string | null {
  if (!pathname.startsWith(FOLDER_PREFIX)) return null;
  try {
    return pathname.slice(FOLDER_PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent).join("/") || null;
  } catch {
    return null;
  }
}

export function isLibraryPath(pathname: string): boolean {
  return pathname === "/" || folderFromPathname(pathname) !== null;
}

export function useCurrentFolder(): string | null {
  return folderFromPathname(useLocation().pathname);
}
