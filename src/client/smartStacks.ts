import { distance } from "fastest-levenshtein";
import type { ArchiveDocument, LibraryItem } from "../shared/types";

/** Documents that seem to belong together; only shown, never stored. */
export interface SmartStack {
  type: "smart";
  /**
   * "name": a numbered series like „Scan 1“, „Scan 2“; "similar": names that are mostly the same, like „Rechnung
   * Telekom Januar“ and „Rechnung Telekom Februar“.
   */
  reason: "name" | "similar";
  title: string;
  /** By number in a series, by name for similar names. */
  documents: ArchiveDocument[];
}

export type DisplayItem = LibraryItem | SmartStack;

/** Numbers in a series may skip a few (deleted or rejected scans). */
const MAX_NUMBER_GAP = 3;
/** Files of one upload arrive seconds apart. */
const MAX_UPLOAD_GAP_MS = 2 * 60_000;
/** Names are compared with this many neighbours in name order, which keeps it fast for large libraries. */
const SIMILARITY_WINDOW = 8;

const baseName = (doc: ArchiveDocument) => (doc.title.trim() || doc.originalName.replace(/\.[^.]+$/, "")).trim();

/**
 * „Scan 003“ → { prefix: "scan", number: 3 }; also „IMG_9816“, „Brief (2)“, „Vertrag Seite 4“, „0001“. Numbers inside
 * the prefix do not count: scanners often put the scan time there (`scan_20260823_143439_000261`, then
 * `scan_20260823_143624_000262`) while the counter at the end goes on.
 */
export function seriesName(name: string): { prefix: string; label: string; number: number } | null {
  const match = /^(.*?)[\s_.-]*[([]?(\d{1,6})[)\]]?$/.exec(name.trim());
  if (!match) return null;
  const label = match[1]!.replace(/[\s_.-]*(seite|page|teil|part|s\.|p\.)$/i, "").replace(/[\s_.-]+$/, "");
  return { prefix: label.toLowerCase().replace(/\d+/g, "#"), label, number: Number(match[2]) };
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

/** Share of a name that has to match: 80 % for short names (a few letters differ a lot), down to 60 % from 30 characters. */
export function similarityThreshold(length: number): number {
  const t = Math.min(1, Math.max(0, (length - 8) / (30 - 8)));
  return 0.8 - t * 0.2;
}

/** 1 for equal names, 0 for completely different ones (Levenshtein distance relative to the longer name). */
export function nameSimilarity(a: string, b: string): number {
  const length = Math.max(a.length, b.length);
  return length === 0 ? 1 : 1 - distance(a, b) / length;
}

/**
 * Names that differ only in their digits (scan times, counters) are left to the series rule: compared as text, all
 * scans of one scanner would look alike.
 */
export function similarNames(a: string, b: string): boolean {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  if (x.replace(/\d+/g, "#") === y.replace(/\d+/g, "#")) return false;
  return nameSimilarity(x, y) >= similarityThreshold(Math.max(x.length, y.length));
}

const byName = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

function similarGroups(docs: ArchiveDocument[]): ArchiveDocument[][] {
  const sorted = [...docs].sort((a, b) => byName.compare(baseName(a), baseName(b)));
  const parent = sorted.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)));
  for (let i = 1; i < sorted.length; i++) {
    for (let j = Math.max(0, i - SIMILARITY_WINDOW); j < i; j++) {
      if (similarNames(baseName(sorted[i]!), baseName(sorted[j]!))) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, ArchiveDocument[]>();
  sorted.forEach((doc, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), doc]));
  return [...groups.values()].filter((group) => group.length > 1);
}

/** „Rechnung Telekom Januar“, „Rechnung Telekom Februar“ → „Rechnung Telekom …“ */
function commonTitle(docs: ArchiveDocument[]): string {
  const names = docs.map(baseName);
  let prefix = names[0]!;
  for (const name of names) while (!name.toLowerCase().startsWith(prefix.toLowerCase())) prefix = prefix.slice(0, -1);
  prefix = prefix.replace(/[\s_.-]+$/, "");
  return prefix.length >= 3 ? `${prefix} …` : `${names[0]} …`;
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

/**
 * Puts documents that belong together into smart stacks at the place of their first document: they have to be
 * uploaded (or created, see the upload's `createdAt`) as a chain, each at most two minutes after the previous one, and
 * have matching names – a numbered series first, then similar names among the rest. Real stacks stay.
 */
export function groupSmartStacks(items: LibraryItem[]): DisplayItem[] {
  const docs = items.flatMap((item) => (item.type === "document" ? [item.document] : []));
  const stacks: SmartStack[] = [];
  for (const chain of timeGroups(docs)) {
    const grouped = new Set<number>();
    for (const group of nameGroups(chain)) {
      const label = seriesName(baseName(group[0]!))!.label;
      stacks.push({ type: "smart", reason: "name", title: label ? `${label} …` : "Nummernfolge", documents: group });
      for (const doc of group) grouped.add(doc.id);
    }
    for (const group of similarGroups(chain.filter((doc) => !grouped.has(doc.id)))) {
      stacks.push({ type: "smart", reason: "similar", title: commonTitle(group), documents: group });
    }
  }

  // Inside a smart stack the documents are in series or name order, as pages of a stack would be.
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
