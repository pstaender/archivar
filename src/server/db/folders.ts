import type { Database } from "bun:sqlite";
import { normalizeFolderPath } from "../../shared/folders";
import type { Folder } from "../../shared/types";
import { HttpError } from "../http";

type OwnerTable = "document_folders" | "stack_folders";
type OwnerColumn = "document_id" | "stack_id";

export class FolderRepository {
  constructor(private db: Database) {}

  list(userId: number): Folder[] {
    return this.db
      .query(
        `SELECT f.id, f.path,
           (SELECT COUNT(*) FROM document_folders df WHERE df.folder_id = f.id) AS documentCount,
           (SELECT COUNT(*) FROM stack_folders sf WHERE sf.folder_id = f.id) AS stackCount
         FROM folders f WHERE f.user_id = ? ORDER BY f.path`,
      )
      .all(userId) as Folder[];
  }

  find(userId: number, id: number): Folder | null {
    return this.list(userId).find((f) => f.id === id) ?? null;
  }

  ensure(userId: number, rawPath: string): number {
    const path = normalizeFolderPath(rawPath);
    if (!path) throw new HttpError(400, "Folder path must not be empty");
    this.db.query("INSERT OR IGNORE INTO folders (user_id, path) VALUES (?, ?)").run(userId, path);
    const row = this.db.query("SELECT id FROM folders WHERE user_id = ? AND path = ?").get(userId, path) as {
      id: number;
    };
    return row.id;
  }

  rename(userId: number, id: number, rawPath: string): void {
    const path = normalizeFolderPath(rawPath);
    if (!path) throw new HttpError(400, "Folder path must not be empty");
    const folder = this.db.query("SELECT path FROM folders WHERE user_id = ? AND id = ?").get(userId, id) as {
      path: string;
    } | null;
    if (!folder) throw new HttpError(404, "Folder not found");
    if (folder.path === path) return;
    if (path.startsWith(`${folder.path}/`)) throw new HttpError(400, "A folder cannot be moved into itself");

    const affected = this.db
      .query("SELECT id, path FROM folders WHERE user_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')")
      .all(userId, folder.path, `${escapeLike(folder.path)}/%`) as { id: number; path: string }[];

    this.db.transaction(() => {
      for (const item of affected) {
        const newPath = path + item.path.slice(folder.path.length);
        const existing = this.db
          .query("SELECT id FROM folders WHERE user_id = ? AND path = ?")
          .get(userId, newPath) as { id: number } | null;
        if (existing) {
          this.mergeInto(item.id, existing.id);
        } else {
          this.db.query("UPDATE folders SET path = ? WHERE id = ?").run(newPath, item.id);
        }
      }
    })();
  }

  private mergeInto(sourceId: number, targetId: number): void {
    this.db
      .query("INSERT OR IGNORE INTO document_folders (document_id, folder_id) SELECT document_id, ? FROM document_folders WHERE folder_id = ?")
      .run(targetId, sourceId);
    this.db
      .query("INSERT OR IGNORE INTO stack_folders (stack_id, folder_id) SELECT stack_id, ? FROM stack_folders WHERE folder_id = ?")
      .run(targetId, sourceId);
    this.db.query("DELETE FROM folders WHERE id = ?").run(sourceId);
  }

  delete(userId: number, id: number): void {
    const folder = this.db.query("SELECT path FROM folders WHERE user_id = ? AND id = ?").get(userId, id) as {
      path: string;
    } | null;
    if (!folder) throw new HttpError(404, "Folder not found");
    this.db
      .query("DELETE FROM folders WHERE user_id = ? AND (path = ? OR path LIKE ? ESCAPE '\\')")
      .run(userId, folder.path, `${escapeLike(folder.path)}/%`);
  }

  setForDocument(userId: number, documentId: number, paths: string[]): void {
    this.setFor("document_folders", "document_id", userId, documentId, paths);
  }

  setForStack(userId: number, stackId: number, paths: string[]): void {
    this.setFor("stack_folders", "stack_id", userId, stackId, paths);
  }

  private setFor(table: OwnerTable, column: OwnerColumn, userId: number, ownerId: number, paths: string[]): void {
    const ids = [...new Set(paths.map(normalizeFolderPath).filter(Boolean))].map((p) => this.ensure(userId, p));
    this.db.transaction(() => {
      this.db.query(`DELETE FROM ${table} WHERE ${column} = ?`).run(ownerId);
      const insert = this.db.query(`INSERT INTO ${table} (${column}, folder_id) VALUES (?, ?)`);
      for (const id of ids) insert.run(ownerId, id);
    })();
  }

  pathsForDocuments(documentIds: number[]): Map<number, string[]> {
    return this.pathsFor("document_folders", "document_id", documentIds);
  }

  pathsForStacks(stackIds: number[]): Map<number, string[]> {
    return this.pathsFor("stack_folders", "stack_id", stackIds);
  }

  private pathsFor(table: OwnerTable, column: OwnerColumn, ids: number[]): Map<number, string[]> {
    const result = new Map<number, string[]>();
    if (ids.length === 0) return result;
    const rows = this.db
      .query(
        `SELECT t.${column} AS ownerId, f.path FROM ${table} t JOIN folders f ON f.id = t.folder_id
         WHERE t.${column} IN (SELECT value FROM json_each(?)) ORDER BY f.path`,
      )
      .all(JSON.stringify(ids)) as { ownerId: number; path: string }[];
    for (const row of rows) {
      const list = result.get(row.ownerId) ?? [];
      list.push(row.path);
      result.set(row.ownerId, list);
    }
    return result;
  }
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
