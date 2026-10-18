import type { JobRepository, QueuedBatchItem } from "../db/jobs";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import { applyNameScheme } from "../../shared/nameScheme";
import type { ArchiveService } from "./archive";

export const UPLOAD_INTERRUPTED_MESSAGE = "Der Upload wurde abgebrochen.";
const DOCUMENT_DELETED_MESSAGE = "Das Dokument wurde gelöscht.";

/** Runs batch jobs in the background, one document at a time; like the OCR queue it only lives in memory. */
export class JobQueue {
  private running: Promise<void> | null = null;

  constructor(
    private jobs: JobRepository,
    private archive: ArchiveService,
  ) {}

  /** Picks up batch jobs a previous server process did not finish. */
  resume(): number {
    const waiting = this.jobs.recover(UPLOAD_INTERRUPTED_MESSAGE);
    if (waiting > 0) this.start();
    return waiting;
  }

  start(): void {
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await Promise.resolve();
    let item: QueuedBatchItem | null;
    while ((item = this.jobs.nextBatchItem()) !== null) await this.process(item);
  }

  private async process({ itemId, userId, documentId, number, count, options }: QueuedBatchItem): Promise<void> {
    this.jobs.updateItem(itemId, { status: "running" });
    try {
      if (documentId === null) throw new Error(DOCUMENT_DELETED_MESSAGE);
      const doc = this.archive.getDocument(userId, documentId);
      let applied = false;
      if (options.rename) {
        await this.archive.updateDocument(userId, doc.id, { title: applyNameScheme(options.rename, number, count) });
        applied = true;
      }
      if (options.preset && doc.kind === "image") {
        const editSettings = await this.archive.applyPreset(userId, doc.id, options.preset.steps, DEFAULT_EDIT_SETTINGS);
        await this.archive.updateDocument(userId, doc.id, { editSettings, shapes: options.preset.steps.shapes });
        applied = true;
      }
      const ocr = options.ocr && doc.kind !== "file";
      if (ocr) this.archive.requestOcr(userId, doc.id, { allText: options.allText }, options.languages);
      this.jobs.updateItem(itemId, { status: applied || ocr ? "done" : "skipped", ocr });
    } catch (error) {
      const message = error instanceof Error ? (error.message === "Document not found" ? DOCUMENT_DELETED_MESSAGE : error.message) : String(error);
      this.jobs.updateItem(itemId, { status: "failed", error: message });
    }
  }
}
