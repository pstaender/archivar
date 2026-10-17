import type { Database } from "bun:sqlite";
import { type BatchOptions, FINISHED_STATES, type Job, type JobItem, type JobItemState, type JobKind } from "../../shared/jobs";
import type { DocumentKind, OcrStatus } from "../../shared/types";

/** Stored item status; `ocr` is derived from the document's text recognition. */
export type JobItemStatus = Exclude<JobItemState, "ocr">;

interface JobRow {
  id: number;
  kind: JobKind;
  options: string | null;
  created_at: string;
}

interface ItemRow {
  id: number;
  job_id: number;
  name: string;
  status: JobItemStatus;
  error: string | null;
  ocr: number;
  document_id: number | null;
  title: string | null;
  original_name: string | null;
  kind: DocumentKind | null;
  updated_at: string | null;
  ocr_status: OcrStatus | null;
  ocr_error: string | null;
}

export interface QueuedBatchItem {
  itemId: number;
  userId: number;
  documentId: number | null;
  options: BatchOptions;
}

const ITEM_COLUMNS = `
  i.id, i.job_id, i.name, i.status, i.error, i.ocr, i.document_id,
  d.title, d.original_name, d.kind, d.updated_at, d.ocr_status, d.ocr_error`;

function toItem(row: ItemRow): JobItem {
  let state: JobItemState = row.status;
  let error = row.error;
  if (row.status === "done" && row.ocr && row.ocr_status) {
    if (row.ocr_status === "pending" || row.ocr_status === "running") state = "ocr";
    else if (row.ocr_status === "failed") {
      state = "failed";
      error = row.ocr_error ?? "Texterkennung fehlgeschlagen";
    }
  }
  return {
    id: row.id,
    name: row.name,
    state,
    error,
    document:
      row.document_id === null
        ? null
        : { id: row.document_id, title: row.title ?? "", originalName: row.original_name ?? "", kind: row.kind ?? "file", updatedAt: row.updated_at ?? "" },
  };
}

export class JobRepository {
  constructor(private db: Database) {}

  create(userId: number, kind: JobKind, options: BatchOptions | null, items: { name: string; documentId: number | null }[]): number {
    return this.db.transaction(() => {
      const { id } = this.db
        .query("INSERT INTO jobs (user_id, kind, options) VALUES (?, ?, ?) RETURNING id")
        .get(userId, kind, options ? JSON.stringify(options) : null) as { id: number };
      const insert = this.db.query("INSERT INTO job_items (job_id, position, name, document_id) VALUES (?, ?, ?, ?)");
      items.forEach((item, position) => insert.run(id, position, item.name, item.documentId));
      return id;
    })();
  }

  list(userId: number): Job[] {
    const jobs = this.db.query("SELECT id, kind, options, created_at FROM jobs WHERE user_id = ? ORDER BY id DESC").all(userId) as JobRow[];
    if (jobs.length === 0) return [];
    const items = this.db
      .query(`SELECT ${ITEM_COLUMNS} FROM job_items i JOIN jobs j ON j.id = i.job_id LEFT JOIN documents d ON d.id = i.document_id WHERE j.user_id = ? ORDER BY i.job_id, i.position`)
      .all(userId) as ItemRow[];
    const byJob = Map.groupBy(items, (row) => row.job_id);
    return jobs.map((job) => {
      const jobItems = (byJob.get(job.id) ?? []).map(toItem);
      return {
        id: job.id,
        kind: job.kind,
        options: job.options ? (JSON.parse(job.options) as BatchOptions) : null,
        createdAt: job.created_at,
        active: jobItems.some((item) => !FINISHED_STATES.includes(item.state)),
        items: jobItems,
      };
    });
  }

  get(userId: number, id: number): Job | null {
    return this.list(userId).find((job) => job.id === id) ?? null;
  }

  /** An item of one of the user's jobs. */
  item(userId: number, itemId: number): { id: number; jobId: number; kind: JobKind; status: JobItemStatus } | null {
    const row = this.db
      .query("SELECT i.id, i.job_id AS jobId, j.kind, i.status FROM job_items i JOIN jobs j ON j.id = i.job_id WHERE i.id = ? AND j.user_id = ?")
      .get(itemId, userId) as { id: number; jobId: number; kind: JobKind; status: JobItemStatus } | null;
    return row ?? null;
  }

  updateItem(itemId: number, fields: { status: JobItemStatus; error?: string | null; documentId?: number; ocr?: boolean }): void {
    this.db
      .query("UPDATE job_items SET status = ?, error = ?, document_id = COALESCE(?, document_id), ocr = COALESCE(?, ocr) WHERE id = ?")
      .run(fields.status, fields.error ?? null, fields.documentId ?? null, fields.ocr === undefined ? null : Number(fields.ocr), itemId);
  }

  /** The oldest batch item still waiting. */
  nextBatchItem(): QueuedBatchItem | null {
    const row = this.db
      .query(
        `SELECT i.id, j.user_id, i.document_id, j.options FROM job_items i JOIN jobs j ON j.id = i.job_id
         WHERE j.kind = 'batch' AND i.status = 'pending' ORDER BY j.id, i.position LIMIT 1`,
      )
      .get() as { id: number; user_id: number; document_id: number | null; options: string } | null;
    return row ? { itemId: row.id, userId: row.user_id, documentId: row.document_id, options: JSON.parse(row.options) as BatchOptions } : null;
  }

  /**
   * After a restart: batch items that were being processed are queued again; uploads that never arrived will not
   * arrive any more. Returns the number of batch items waiting.
   */
  recover(message: string): number {
    this.db.query("UPDATE job_items SET status = 'pending' WHERE status = 'running' AND job_id IN (SELECT id FROM jobs WHERE kind = 'batch')").run();
    this.db
      .query("UPDATE job_items SET status = 'failed', error = ? WHERE status IN ('pending', 'running') AND job_id IN (SELECT id FROM jobs WHERE kind = 'import')")
      .run(message);
    return (this.db.query("SELECT COUNT(*) AS n FROM job_items i JOIN jobs j ON j.id = i.job_id WHERE j.kind = 'batch' AND i.status = 'pending'").get() as { n: number }).n;
  }

  delete(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM jobs WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }
}
