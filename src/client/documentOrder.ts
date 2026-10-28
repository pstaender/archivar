const KEY = "archivar.documentOrder";
const LOCATION_KEY = "archivar.libraryLocation";

/** Remembers the documents the library shows (in this browser tab), so the document page can step through them. */
export function rememberDocumentOrder(ids: number[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Without storage the document page just has no previous/next document.
  }
}

export function documentOrder(): number[] {
  try {
    const ids: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

/** Remembers the library page last shown (path and query, in this browser tab), so „Zurück“ returns to it. */
export function rememberLibraryLocation(href: string): void {
  try {
    sessionStorage.setItem(LOCATION_KEY, href);
  } catch {}
}

export function libraryLocation(): string {
  return rememberedLibraryLocation() ?? "/";
}

/** The library page last shown in this browser tab, null when none was. */
export function rememberedLibraryLocation(): string | null {
  try {
    const href = sessionStorage.getItem(LOCATION_KEY);
    return href?.startsWith("/") ? href : null;
  } catch {
    return null;
  }
}

/** The hash marking the item to scroll to when going back to a list: `#34` for document 34, `#stack-5` for stack 5. */
export function itemHash(item: { type: "document" | "stack"; id: number }): string {
  return item.type === "document" ? `#${item.id}` : `#stack-${item.id}`;
}

export function itemFromHash(hash: string): { type: "document" | "stack"; id: number } | null {
  const match = /^#(stack-)?(\d+)$/.exec(hash);
  if (!match) return null;
  return { type: match[1] ? "stack" : "document", id: Number(match[2]) };
}
