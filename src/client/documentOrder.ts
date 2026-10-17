const KEY = "archivar.documentOrder";

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
