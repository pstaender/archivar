import type { PresetSteps } from "./presets";
import type { DocumentKind } from "./types";

export type JobKind = "batch" | "import";

/** What a batch job does with each document. */
export interface BatchOptions {
  /** Snapshot of the preset when the job was started, so later edits do not change a running job. */
  preset: { name: string; steps: PresetSteps } | null;
  ocr: boolean;
  /** Null: the default languages. */
  languages: string[] | null;
  allText: boolean;
  /** New names: `{n}` is the document's number (from 1), `{m}` the number of documents; null keeps the names. */
  rename?: string | null;
}

export interface BatchJobCreate {
  kind: "batch";
  documentIds: number[];
  presetId: number | null;
  ocr: boolean;
  languages: string[] | null;
  allText: boolean;
  rename?: string | null;
}

export interface ImportJobCreate {
  kind: "import";
  /** File names in upload order; each gets an item that the upload of that file fills in (`jobItemId`). */
  files: string[];
}

export type JobCreate = BatchJobCreate | ImportJobCreate;

/**
 * `pending`: waiting (imports: for the upload), `running`: being processed, `ocr`: processed, text recognition still
 * queued or running, `skipped`: nothing applied (e.g. OCR for other files).
 */
export type JobItemState = "pending" | "running" | "ocr" | "done" | "skipped" | "failed";

export interface JobItem {
  id: number;
  name: string;
  state: JobItemState;
  error: string | null;
  /** E.g. that the uploaded file was already in the archive. */
  note: string | null;
  /** Null until an import uploaded the file, or after the document was deleted. */
  document: { id: number; title: string; originalName: string; kind: DocumentKind; updatedAt: string } | null;
}

export interface Job {
  id: number;
  kind: JobKind;
  /** Only for batch jobs. */
  options: BatchOptions | null;
  createdAt: string;
  /** Some items are not finished yet (including their text recognition). */
  active: boolean;
  /** When the last item finished; null while active and for jobs from before finish times were stored. */
  finishedAt: string | null;
  items: JobItem[];
}

export function duplicateNote(duplicates: { title: string }[]): string {
  return `Already stored as ${duplicates.map((doc) => `"${doc.title}"`).join(", ")}`;
}

export const FINISHED_STATES: JobItemState[] = ["done", "skipped", "failed"];
