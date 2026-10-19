import type { Database } from "bun:sqlite";
import type { ExternalSource, ExternalSourceType } from "../../shared/externalSources";

interface SourceRow {
  id: number;
  user_id: number;
  name: string;
  type: ExternalSourceType;
  url: string;
  credentials: string | null;
  created_at: string;
  document_count: number;
}

export interface StoredExternalSource extends ExternalSource {
  userId: number;
  credentials: Record<string, string> | null;
}

const SELECT = `SELECT s.*, (SELECT COUNT(*) FROM document_sources ds WHERE ds.source_id = s.id) AS document_count FROM external_sources s`;

function toSource(row: SourceRow): StoredExternalSource {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    url: row.url,
    credentials: row.credentials ? (JSON.parse(row.credentials) as Record<string, string>) : null,
    hasCredentials: row.credentials !== null,
    documentCount: row.document_count,
    createdAt: row.created_at,
  };
}

export function toPublicSource({ userId: _userId, credentials: _credentials, ...source }: StoredExternalSource): ExternalSource {
  return source;
}

export class ExternalSourceRepository {
  constructor(private db: Database) {}

  list(userId: number): StoredExternalSource[] {
    return (this.db.query(`${SELECT} WHERE s.user_id = ? ORDER BY s.name COLLATE NOCASE, s.id`).all(userId) as SourceRow[]).map(toSource);
  }

  get(userId: number, id: number): StoredExternalSource | null {
    const row = this.db.query(`${SELECT} WHERE s.user_id = ? AND s.id = ?`).get(userId, id) as SourceRow | null;
    return row ? toSource(row) : null;
  }

  create(userId: number, input: { name: string; type: ExternalSourceType; url: string; credentials: Record<string, string> | null }): StoredExternalSource {
    const { id } = this.db
      .query("INSERT INTO external_sources (user_id, name, type, url, credentials) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get(userId, input.name, input.type, input.url, input.credentials ? JSON.stringify(input.credentials) : null) as { id: number };
    return this.get(userId, id)!;
  }

  /** `credentials` undefined keeps them, null removes them. */
  update(userId: number, id: number, fields: { name?: string; url?: string; credentials?: Record<string, string> | null }): StoredExternalSource | null {
    this.db
      .query(
        `UPDATE external_sources SET name = COALESCE($name, name), url = COALESCE($url, url),
           credentials = CASE WHEN $keepCredentials THEN credentials ELSE $credentials END
         WHERE user_id = $userId AND id = $id`,
      )
      .run({
        userId,
        id,
        name: fields.name ?? null,
        url: fields.url ?? null,
        keepCredentials: fields.credentials === undefined ? 1 : 0,
        credentials: fields.credentials ? JSON.stringify(fields.credentials) : null,
      });
    return this.get(userId, id);
  }

  /** The documents stay; they only lose the link to the source. */
  delete(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM external_sources WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }

  /** The oldest document imported from each of the paths that still exists. */
  importedDocuments(sourceId: number, paths: string[]): Map<string, number> {
    if (paths.length === 0) return new Map();
    const rows = this.db
      .query("SELECT path, MIN(document_id) AS id FROM document_sources WHERE source_id = ? AND path IN (SELECT value FROM json_each(?)) GROUP BY path")
      .all(sourceId, JSON.stringify(paths)) as { path: string; id: number }[];
    return new Map(rows.map((row) => [row.path, row.id]));
  }

  link(documentId: number, sourceId: number, file: { path: string; size: number; modifiedAt: string | null }): void {
    this.db
      .query("INSERT OR REPLACE INTO document_sources (document_id, source_id, path, size, modified_at) VALUES (?, ?, ?, ?, ?)")
      .run(documentId, sourceId, file.path, file.size, file.modifiedAt);
  }
}
