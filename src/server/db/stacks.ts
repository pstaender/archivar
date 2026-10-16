import type { Database } from "bun:sqlite";
import type { Stack } from "../../shared/types";
import { escapeLike, type FolderRepository } from "./folders";

interface StackRow {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StackFilter {
  folder?: string;
  q?: string;
}

export class StackRepository {
  constructor(
    private db: Database,
    private folders: FolderRepository,
  ) {}

  create(userId: number, title: string): number {
    const row = this.db.query("INSERT INTO stacks (user_id, title) VALUES (?, ?) RETURNING id").get(userId, title) as {
      id: number;
    };
    return row.id;
  }

  get(userId: number, id: number): Stack | null {
    const row = this.db
      .query("SELECT id, title, created_at, updated_at FROM stacks WHERE user_id = ? AND id = ?")
      .get(userId, id) as StackRow | null;
    return row ? this.hydrate([row])[0]! : null;
  }

  list(userId: number, filter: StackFilter = {}): Stack[] {
    const where = ["s.user_id = $userId"];
    const params: Record<string, string | number> = { userId };
    if (filter.q) {
      where.push(`(s.title LIKE $q ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM documents d WHERE d.stack_id = s.id
          AND (d.title LIKE $q ESCAPE '\\' OR d.original_name LIKE $q ESCAPE '\\' OR d.ocr_text LIKE $q ESCAPE '\\')))`);
      params.q = `%${escapeLike(filter.q)}%`;
    }
    if (filter.folder) {
      where.push(`(
        EXISTS (SELECT 1 FROM stack_folders sf JOIN folders f ON f.id = sf.folder_id
          WHERE sf.stack_id = s.id AND (f.path = $folder OR f.path LIKE $folderPrefix ESCAPE '\\'))
        OR EXISTS (SELECT 1 FROM documents d JOIN document_folders df ON df.document_id = d.id JOIN folders f ON f.id = df.folder_id
          WHERE d.stack_id = s.id AND (f.path = $folder OR f.path LIKE $folderPrefix ESCAPE '\\')))`);
      params.folder = filter.folder;
      params.folderPrefix = `${escapeLike(filter.folder)}/%`;
    }
    const rows = this.db
      .query(
        `SELECT s.id, s.title, s.created_at, s.updated_at FROM stacks s
         WHERE ${where.join(" AND ")} ORDER BY s.updated_at DESC, s.id DESC`,
      )
      .all(params) as StackRow[];
    return this.hydrate(rows);
  }

  update(userId: number, id: number, fields: { title?: string }): void {
    if (fields.title !== undefined) {
      this.db.query("UPDATE stacks SET title = ? WHERE user_id = ? AND id = ?").run(fields.title, userId, id);
    }
    this.touch(id);
  }

  touch(id: number): void {
    this.db.query("UPDATE stacks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
  }

  delete(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM stacks WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }

  deleteIfEmpty(id: number): void {
    this.db.query("DELETE FROM stacks WHERE id = ? AND NOT EXISTS (SELECT 1 FROM documents WHERE stack_id = ?)").run(id, id);
  }

  private hydrate(rows: StackRow[]): Stack[] {
    const ids = rows.map((r) => r.id);
    const folders = this.folders.pathsForStacks(ids);
    const members = new Map<number, number[]>();
    if (ids.length > 0) {
      const docs = this.db
        .query(
          `SELECT id, stack_id AS stackId FROM documents WHERE stack_id IN (SELECT value FROM json_each(?))
           ORDER BY stack_position, id`,
        )
        .all(JSON.stringify(ids)) as { id: number; stackId: number }[];
      for (const doc of docs) {
        const list = members.get(doc.stackId) ?? [];
        list.push(doc.id);
        members.set(doc.stackId, list);
      }
    }
    return rows.map((row) => {
      const documentIds = members.get(row.id) ?? [];
      return {
        id: row.id,
        title: row.title,
        folders: folders.get(row.id) ?? [],
        documentIds,
        coverDocumentId: documentIds[0] ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }
}
