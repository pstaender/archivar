import type { ArchiveDocument, LibraryItem } from "../shared/types";

/** Documents that seem to belong together; only shown, never stored. */
export interface SmartStack {
  type: "smart";
  /** "name": a numbered series like „Scan 1“, „Scan 2“; "time": uploaded right after each other. */
  reason: "name" | "time";
  title: string;
  /** By number in a series, by upload time otherwise. */
  documents: ArchiveDocument[];
}

export type DisplayItem = LibraryItem | SmartStack;

/** Numbers in a series may skip a few (deleted or rejected scans). */
const MAX_NUMBER_GAP = 3;
/** Files of one upload arrive seconds apart. */
const MAX_UPLOAD_GAP_MS = 2 * 60_000;

const baseName = (doc: ArchiveDocument) => (doc.title.trim() || doc.originalName.replace(/\.[^.]+$/, "")).trim();

/** „Scan 003“ → { prefix: "scan", number: 3 }; also „IMG_9816“, „Brief (2)“, „Vertrag Seite 4“, „0001“. */
export function seriesName(name: string): { prefix: string; label: string; number: number } | null {
  const match = /^(.*?)[\s_.-]*[([]?(\d{1,6})[)\]]?$/.exec(name.trim());
  if (!match) return null;
  const label = match[1]!.replace(/[\s_.-]*(seite|page|teil|part|s\.|p\.)$/i, "").replace(/[\s_.-]+$/, "");
  return { prefix: label.toLowerCase(), label, number: Number(match[2]) };
}

function nameGroups(docs: ArchiveDocument[]): ArchiveDocument[][] {
  const byPrefix = new Map<string, { doc: ArchiveDocument; number: number }[]>();
  for (const doc of docs) {
    const series = seriesName(baseName(doc));
    if (!series) continue;
    const list = byPrefix.get(series.prefix) ?? [];
    list.push({ doc, number: series.number });
    byPrefix.set(series.prefix, list);
  }
  const groups: ArchiveDocument[][] = [];
  for (const list of byPrefix.values()) {
    list.sort((a, b) => a.number - b.number);
    let run: typeof list = [];
    for (const entry of list) {
      const last = run.at(-1);
      if (last && entry.number - last.number > MAX_NUMBER_GAP) {
        if (run.length > 1) groups.push(run.map((e) => e.doc));
        run = [];
      }
      run.push(entry);
    }
    if (run.length > 1) groups.push(run.map((e) => e.doc));
  }
  return groups;
}

function timeGroups(docs: ArchiveDocument[]): ArchiveDocument[][] {
  const sorted = [...docs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const groups: ArchiveDocument[][] = [];
  let run: ArchiveDocument[] = [];
  for (const doc of sorted) {
    const last = run.at(-1);
    if (last && Date.parse(doc.createdAt) - Date.parse(last.createdAt) > MAX_UPLOAD_GAP_MS) {
      if (run.length > 1) groups.push(run);
      run = [];
    }
    run.push(doc);
  }
  if (run.length > 1) groups.push(run);
  return groups;
}

const uploadTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

/**
 * Puts documents that belong together into smart stacks at the place of their first document: numbered series by
 * name first (they may have been uploaded at different times), then what is left by upload time. Real stacks stay.
 */
export function groupSmartStacks(items: LibraryItem[]): DisplayItem[] {
  const docs = items.flatMap((item) => (item.type === "document" ? [item.document] : []));
  const stacks: SmartStack[] = [];
  const grouped = new Set<number>();
  for (const group of nameGroups(docs)) {
    const label = seriesName(baseName(group[0]!))!.label;
    stacks.push({ type: "smart", reason: "name", title: label ? `${label} …` : "Nummernfolge", documents: group });
    for (const doc of group) grouped.add(doc.id);
  }
  for (const group of timeGroups(docs.filter((doc) => !grouped.has(doc.id)))) {
    stacks.push({ type: "smart", reason: "time", title: `Hochgeladen ${uploadTime.format(new Date(group[0]!.createdAt))}`, documents: group });
    for (const doc of group) grouped.add(doc.id);
  }

  // Inside a smart stack the documents are in series or upload order, as pages of a stack would be.
  const stackOf = new Map<number, SmartStack>();
  for (const stack of stacks) for (const doc of stack.documents) stackOf.set(doc.id, stack);

  const result: DisplayItem[] = [];
  const placed = new Set<SmartStack>();
  for (const item of items) {
    const stack = item.type === "document" ? stackOf.get(item.document.id) : undefined;
    if (!stack) result.push(item);
    else if (!placed.has(stack)) {
      placed.add(stack);
      result.push(stack);
    }
  }
  return result;
}

export const smartStackKey = (stack: SmartStack) => `m${stack.documents.map((doc) => doc.id).join("-")}`;
