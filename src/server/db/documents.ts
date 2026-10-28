import type { Database } from "bun:sqlite";
import { normalizeEditSettings } from "../../shared/editSettings";
import { normalizeShapes, type ShapeLayer, shapeGeometry } from "../../shared/shapes";
import type { ArchiveDocument, DocumentKind, DocumentRef, DocumentSource, EditSettings, OcrStatus } from "../../shared/types";
import { escapeLike, type FolderRepository } from "./folders";

interface DocumentRow {
  id: number;
  user_id: number;
  title: string;
  original_name: string;
  mime_type: string;
  kind: DocumentKind;
  size: number;
  storage_key: string;
  width: number | null;
  height: number | null;
  page_count: number | null;
  stack_id: number | null;
  stack_position: number;
  edit_settings: string;
  ocr_text: string;
  ocr_status: OcrStatus;
  ocr_confidence: number | null;
  ocr_error: string | null;
  ocr_removed: number;
  ocr_all_text: number;
  ocr_language: string | null;
  ocr_languages: string | null;
  shapes: string | null;
  copy_of: number | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface StoredDocument extends ArchiveDocument {
  userId: number;
  storageKey: string;
}

export interface DocumentCreate {
  userId: number;
  title: string;
  originalName: string;
  mimeType: string;
  kind: DocumentKind;
  size: number;
  storageKey: string;
  /** Hex SHA-256 of the uploaded file. */
  sha256?: string | null;
  width?: number | null;
  height?: number | null;
  pageCount?: number | null;
  ocrText?: string;
  ocrStatus?: OcrStatus;
  ocrLanguage?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface DocumentFilter {
  folder?: string;
  q?: string;
  stackId?: number | null;
}

/** Where the recognized lines are, as fractions (0..1) of the image rendered with `editSettings`. */
export interface OcrLayout {
  editSettings: EditSettings;
  lines: { text: string; box: [x0: number, y0: number, x1: number, y1: number] }[];
}

export interface OcrResultUpdate {
  status: OcrStatus;
  text?: string;
  confidence?: number | null;
  error?: string | null;
  removed?: number;
  /** Detected language of `text`. */
  language?: string | null;
  /** `text` keeps all text parts, also unsure ones. */
  allText?: boolean;
}

export class DocumentRepository {
  constructor(
    private db: Database,
    private folders: FolderRepository,
  ) {}

  create(input: DocumentCreate): StoredDocument {
    const row = this.db
      .query(
        `INSERT INTO documents (user_id, title, original_name, mime_type, kind, size, storage_key, sha256, width, height, page_count, ocr_text, ocr_status, ocr_language, metadata, created_at)
         VALUES ($userId, $title, $originalName, $mimeType, $kind, $size, $storageKey, $sha256, $width, $height, $pageCount, $ocrText, $ocrStatus, $ocrLanguage, $metadata,
                 COALESCE($createdAt, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
         RETURNING id`,
      )
      .get({
        userId: input.userId,
        title: input.title,
        originalName: input.originalName,
        mimeType: input.mimeType,
        kind: input.kind,
        size: input.size,
        storageKey: input.storageKey,
        sha256: input.sha256 ?? null,
        width: input.width ?? null,
        height: input.height ?? null,
        pageCount: input.pageCount ?? null,
        ocrText: input.ocrText ?? "",
        ocrStatus: input.ocrStatus ?? "none",
        ocrLanguage: input.ocrLanguage ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: input.createdAt ?? null,
      }) as { id: number };
    return this.get(input.userId, row.id)!;
  }

  get(userId: number, id: number): StoredDocument | null {
    const row = this.db.query("SELECT * FROM documents WHERE user_id = ? AND id = ?").get(userId, id) as DocumentRow | null;
    return row ? this.hydrate([row])[0]! : null;
  }

  /** The user's other documents with the same file content. */
  findBySha256(userId: number, sha256: string, exceptId: number): { id: number; title: string; originalName: string }[] {
    return this.db
      .query("SELECT id, title, original_name AS originalName FROM documents WHERE user_id = ? AND sha256 = ? AND id != ? ORDER BY id")
      .all(userId, sha256, exceptId) as { id: number; title: string; originalName: string }[];
  }

  /** Documents stored before file hashes were recorded, across all users. */
  withoutSha256(): { id: number; storageKey: string }[] {
    return this.db.query("SELECT id, storage_key AS storageKey FROM documents WHERE sha256 IS NULL ORDER BY id").all() as { id: number; storageKey: string }[];
  }

  setSha256(id: number, sha256: string): void {
    this.db.query("UPDATE documents SET sha256 = ? WHERE id = ?").run(sha256, id);
  }

  /** Documents whose OCR was queued or running, across all users. */
  unfinishedOcrIds(): number[] {
    const rows = this.db.query("SELECT id FROM documents WHERE ocr_status IN ('pending', 'running') ORDER BY id").all() as { id: number }[];
    return rows.map((row) => row.id);
  }

  getById(id: number): StoredDocument | null {
    const row = this.db.query("SELECT * FROM documents WHERE id = ?").get(id) as DocumentRow | null;
    return row ? this.hydrate([row])[0]! : null;
  }

  list(userId: number, filter: DocumentFilter = {}): StoredDocument[] {
    const where = ["d.user_id = $userId"];
    const params: Record<string, string | number | null> = { userId };
    if (filter.stackId === null) where.push("d.stack_id IS NULL");
    if (typeof filter.stackId === "number") {
      where.push("d.stack_id = $stackId");
      params.stackId = filter.stackId;
    }
    if (filter.q) {
      where.push("(d.title LIKE $q ESCAPE '\\' OR d.original_name LIKE $q ESCAPE '\\' OR d.ocr_text LIKE $q ESCAPE '\\')");
      params.q = `%${escapeLike(filter.q)}%`;
    }
    if (filter.folder) {
      where.push(
        `EXISTS (SELECT 1 FROM document_folders df JOIN folders f ON f.id = df.folder_id
          WHERE df.document_id = d.id AND (f.path = $folder OR f.path LIKE $folderPrefix ESCAPE '\\'))`,
      );
      params.folder = filter.folder;
      params.folderPrefix = `${escapeLike(filter.folder)}/%`;
    }
    const order = typeof filter.stackId === "number" ? "d.stack_position, d.id" : "d.updated_at DESC, d.id DESC";
    const rows = this.db
      .query(`SELECT d.* FROM documents d WHERE ${where.join(" AND ")} ORDER BY ${order}`)
      .all(params) as DocumentRow[];
    return this.hydrate(rows);
  }

  /** Changes whenever something shown in the library changes, so clients can poll it instead of the whole list. */
  libraryVersion(userId: number): string {
    const row = this.db
      .query(
        `SELECT
           (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) || ':' || IFNULL(MAX(updated_at), '') || ':' || TOTAL(IFNULL(stack_id, 0) * id)
              FROM documents WHERE user_id = $user) AS documents,
           (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) || ':' || IFNULL(MAX(updated_at), '') FROM stacks WHERE user_id = $user) AS stacks,
           (SELECT COUNT(*) || ':' || TOTAL(df.document_id * f.id) FROM document_folders df JOIN folders f ON f.id = df.folder_id
              WHERE f.user_id = $user) AS documentFolders,
           (SELECT COUNT(*) || ':' || TOTAL(sf.stack_id * f.id) FROM stack_folders sf JOIN folders f ON f.id = sf.folder_id
              WHERE f.user_id = $user) AS stackFolders,
           (SELECT COUNT(*) || ':' || TOTAL(o.item_id * (o.position + 1) * f.id) FROM folder_order o JOIN folders f ON f.id = o.folder_id
              WHERE f.user_id = $user) AS folderOrder`,
      )
      .get({ user: userId }) as Record<string, string>;
    return Object.values(row).join("|");
  }

  update(
    userId: number,
    id: number,
    fields: {
      title?: string;
      editSettings?: EditSettings;
      shapes?: ShapeLayer | null;
      ocrText?: string;
      ocrLanguage?: string | null;
      width?: number;
      height?: number;
    },
  ): StoredDocument | null {
    const sets: string[] = [];
    const params: Record<string, string | number | null> = { userId, id };
    if (fields.title !== undefined) {
      sets.push("title = $title");
      params.title = fields.title;
    }
    if (fields.editSettings !== undefined) {
      sets.push("edit_settings = $editSettings");
      params.editSettings = JSON.stringify(fields.editSettings);
    }
    if (fields.shapes !== undefined) {
      sets.push("shapes = $shapes");
      params.shapes = fields.shapes ? JSON.stringify(fields.shapes) : null;
    }
    if (fields.ocrText !== undefined) {
      sets.push("ocr_text = $ocrText");
      params.ocrText = fields.ocrText;
    }
    if (fields.ocrLanguage !== undefined) {
      sets.push("ocr_language = $ocrLanguage");
      params.ocrLanguage = fields.ocrLanguage;
    }
    if (fields.width !== undefined && fields.height !== undefined) {
      sets.push("width = $width", "height = $height");
      params.width = fields.width;
      params.height = fields.height;
    }
    this.db
      .query(
        `UPDATE documents SET ${[...sets, "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"].join(", ")}
         WHERE user_id = $userId AND id = $id`,
      )
      .run(params);
    return this.get(userId, id);
  }

  touch(id: number): void {
    this.db.query("UPDATE documents SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
  }

  setOcrResult(id: number, result: OcrResultUpdate): void {
    this.db
      .query(
        `UPDATE documents SET ocr_status = $status,
           ocr_text = COALESCE($text, ocr_text),
           ocr_confidence = CASE WHEN $hasConfidence THEN $confidence ELSE ocr_confidence END,
           ocr_error = $error,
           ocr_removed = CASE WHEN $text IS NULL THEN ocr_removed ELSE $removed END,
           ocr_language = CASE WHEN $text IS NULL THEN ocr_language ELSE $language END,
           ocr_all_text = CASE WHEN $text IS NULL THEN ocr_all_text ELSE $allText END,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $id`,
      )
      .run({
        id,
        status: result.status,
        text: result.text ?? null,
        hasConfidence: result.confidence !== undefined ? 1 : 0,
        confidence: result.confidence ?? null,
        error: result.error ?? null,
        removed: result.removed ?? 0,
        language: result.language ?? null,
        allText: result.allText ? 1 : 0,
      });
    // Job items waiting for this document's text recognition keep its outcome; later runs do not change them.
    if (result.status === "done" || result.status === "failed") {
      this.db
        .query(
          `UPDATE job_items SET ocr_settled = 1, ocr_finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             status = CASE WHEN $failed THEN 'failed' ELSE status END,
             error = CASE WHEN $failed THEN $error ELSE error END
           WHERE document_id = $id AND ocr = 1 AND status = 'done' AND ocr_settled = 0`,
        )
        .run({ id, failed: result.status === "failed" ? 1 : 0, error: result.error ?? "Text recognition failed" });
    }
  }

  /** Documents with text but no detected language (recognized before languages were detected, or unclear). */
  withoutLanguage(): { id: number; text: string }[] {
    return this.db.query("SELECT id, ocr_text AS text FROM documents WHERE ocr_language IS NULL AND ocr_text != ''").all() as { id: number; text: string }[];
  }

  setOcrLanguage(id: number, language: string | null): void {
    this.db.query("UPDATE documents SET ocr_language = ? WHERE id = ?").run(language, id);
  }

  /** Languages for the next text recognition of the document; null means the server's default. */
  setOcrLanguages(id: number, languages: string[] | null): void {
    this.db.query("UPDATE documents SET ocr_languages = ? WHERE id = ?").run(languages?.join("+") ?? null, id);
  }

  // Kept out of hydrate(): it is only needed for the PDF export and can be large.
  setOcrLayout(id: number, layout: OcrLayout | null): void {
    this.db.query("UPDATE documents SET ocr_layout = ? WHERE id = ?").run(layout ? JSON.stringify(layout) : null, id);
  }

  getOcrLayout(userId: number, id: number): OcrLayout | null {
    const row = this.db.query("SELECT ocr_layout FROM documents WHERE user_id = ? AND id = ?").get(userId, id) as { ocr_layout: string | null } | null;
    return row?.ocr_layout ? (JSON.parse(row.ocr_layout) as OcrLayout) : null;
  }

  assignToStack(userId: number, stackId: number | null, documentIds: number[]): void {
    const update = this.db.query(
      "UPDATE documents SET stack_id = ?, stack_position = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND id = ?",
    );
    this.db.transaction(() => {
      documentIds.forEach((id, position) => update.run(stackId, position, userId, id));
    })();
  }

  /** Copies the document with its settings, text, folders and vector areas; the copy uses the same original file. */
  duplicate(userId: number, id: number, title: string): StoredDocument {
    const columns =
      "user_id, original_name, mime_type, kind, size, storage_key, sha256, width, height, page_count, edit_settings, shapes, ocr_text, ocr_status, ocr_confidence, ocr_error, ocr_removed, ocr_all_text, ocr_language, ocr_languages, ocr_layout, metadata";
    const copyId = this.db.transaction(() => {
      const row = this.db
        .query(
          `INSERT INTO documents (${columns}, title, copy_of)
           SELECT ${columns}, $title, COALESCE(copy_of, id) FROM documents WHERE user_id = $userId AND id = $id
           RETURNING id`,
        )
        .get({ userId, id, title }) as { id: number };
      this.db.query("INSERT INTO document_folders (document_id, folder_id) SELECT ?, folder_id FROM document_folders WHERE document_id = ?").run(row.id, id);
      this.db
        .query("INSERT INTO document_vectors (document_id, areas, area_count, geometry) SELECT ?, areas, area_count, geometry FROM document_vectors WHERE document_id = ?")
        .run(row.id, id);
      return row.id;
    })();
    return this.get(userId, copyId)!;
  }

  /** Points the document to a new original file; its recognized text layout no longer fits. */
  replaceFile(
    userId: number,
    id: number,
    file: { storageKey: string; mimeType: string; kind: DocumentKind; size: number; sha256: string; width: number | null; height: number | null; pageCount: number | null; metadata: Record<string, unknown> },
  ): void {
    this.db
      .query(
        `UPDATE documents SET storage_key = $storageKey, mime_type = $mimeType, kind = $kind, size = $size, sha256 = $sha256, width = $width,
           height = $height, page_count = $pageCount, metadata = $metadata, ocr_layout = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE user_id = $userId AND id = $id`,
      )
      .run({ userId, id, ...file, metadata: JSON.stringify(file.metadata) });
  }

  /** Makes a duplicate independent with its own copy of the original file. */
  detach(userId: number, id: number, storageKey: string): void {
    this.db
      .query("UPDATE documents SET copy_of = NULL, storage_key = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ? AND id = ?")
      .run(storageKey, userId, id);
  }

  /** Before the document is deleted, its oldest duplicate becomes the original of the others. */
  handOverCopies(id: number): void {
    this.db.transaction(() => {
      const heir = this.db.query("SELECT MIN(id) AS id FROM documents WHERE copy_of = ?").get(id) as { id: number | null };
      if (heir.id === null) return;
      this.db.query("UPDATE documents SET copy_of = NULL WHERE id = ?").run(heir.id);
      this.db.query("UPDATE documents SET copy_of = ? WHERE copy_of = ?").run(heir.id, id);
    })();
  }

  storageKeyInUse(storageKey: string): boolean {
    return this.db.query("SELECT 1 FROM documents WHERE storage_key = ? LIMIT 1").get(storageKey) !== null;
  }

  delete(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM documents WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }

  private vectorSummaries(ids: number[]): Map<number, { count: number; geometry: string }> {
    const result = new Map<number, { count: number; geometry: string }>();
    if (ids.length === 0) return result;
    const rows = this.db
      .query("SELECT document_id AS id, area_count AS count, geometry FROM document_vectors WHERE document_id IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(ids)) as { id: number; count: number; geometry: string }[];
    for (const { id, count, geometry } of rows) result.set(id, { count, geometry });
    return result;
  }

  /** Originals and duplicates of the documents, by id. */
  private relations(rows: DocumentRow[]): { refs: Map<number, DocumentRef>; copies: Map<number, DocumentRef[]> } {
    const refs = new Map<number, DocumentRef>();
    const copies = new Map<number, DocumentRef[]>();
    if (rows.length === 0) return { refs, copies };
    const originals = [...new Set(rows.map((r) => r.copy_of).filter((id): id is number => id !== null))];
    const found = this.db
      .query(
        `SELECT id, title, original_name AS originalName, copy_of AS copyOf FROM documents
         WHERE id IN (SELECT value FROM json_each($originals)) OR copy_of IN (SELECT value FROM json_each($ids))
         ORDER BY id`,
      )
      .all({ originals: JSON.stringify(originals), ids: JSON.stringify(rows.map((r) => r.id)) }) as {
      id: number;
      title: string;
      originalName: string;
      copyOf: number | null;
    }[];
    for (const row of found) {
      const ref = { id: row.id, title: row.title.trim() || row.originalName };
      refs.set(row.id, ref);
      if (row.copyOf !== null) copies.set(row.copyOf, [...(copies.get(row.copyOf) ?? []), ref]);
    }
    return { refs, copies };
  }

  private sources(ids: number[]): Map<number, DocumentSource> {
    if (ids.length === 0) return new Map();
    const rows = this.db
      .query(
        `SELECT ds.document_id AS documentId, s.id, s.name, ds.path FROM document_sources ds JOIN external_sources s ON s.id = ds.source_id
         WHERE ds.document_id IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(ids)) as (DocumentSource & { documentId: number })[];
    return new Map(rows.map(({ documentId, ...source }) => [documentId, source]));
  }

  private hydrate(rows: DocumentRow[]): StoredDocument[] {
    const folders = this.folders.pathsForDocuments(rows.map((r) => r.id));
    const vectors = this.vectorSummaries(rows.map((r) => r.id));
    const sources = this.sources(rows.map((r) => r.id));
    const relations = this.relations(rows);
    return rows.map((row) => {
      const editSettings = normalizeEditSettings(JSON.parse(row.edit_settings));
      const layer = row.shapes ? (JSON.parse(row.shapes) as ShapeLayer) : null;
      const shapes = normalizeShapes(layer?.shapes);
      const vector = vectors.get(row.id);
      return {
      id: row.id,
      userId: row.user_id,
      storageKey: row.storage_key,
      title: row.title,
      originalName: row.original_name,
      mimeType: row.mime_type,
      kind: row.kind,
      size: row.size,
      width: row.width,
      height: row.height,
      pageCount: row.page_count,
      stackId: row.stack_id,
      stackPosition: row.stack_position,
      editSettings,
      shapes,
      shapesOutdated: shapes.length > 0 && layer?.geometry !== shapeGeometry(editSettings),
      vectorCount: vector?.count ?? 0,
      vectorsOutdated: vector !== undefined && vector.geometry !== shapeGeometry(editSettings),
      ocrText: row.ocr_text,
      ocrStatus: row.ocr_status,
      ocrConfidence: row.ocr_confidence,
      ocrError: row.ocr_error,
      ocrRemoved: row.ocr_removed,
      ocrAllText: row.ocr_all_text === 1,
      ocrLanguage: row.ocr_language,
      ocrLanguages: row.ocr_languages ? row.ocr_languages.split("+") : null,
      metadata: JSON.parse(row.metadata),
      folders: folders.get(row.id) ?? [],
      copyOf: row.copy_of === null ? null : (relations.refs.get(row.copy_of) ?? null),
      copies: relations.copies.get(row.id) ?? [],
      source: sources.get(row.id) ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      };
    });
  }
}

export function toPublicDocument(doc: StoredDocument): ArchiveDocument {
  const { userId: _userId, storageKey: _storageKey, ...rest } = doc;
  return rest;
}
