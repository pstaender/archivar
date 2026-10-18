import type { Database } from "bun:sqlite";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { makeZip } from "client-zip";

export const EXPORT_DATABASE_NAME = "archivar.sqlite";
export const EXPORT_FILES_DIR = "files";

interface StoredFile {
  key: string;
  size: number;
  lastModified: Date;
}

async function storedFiles(storageDir: string): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  try {
    for await (const key of new Bun.Glob("**/*").scan({ cwd: storageDir, onlyFiles: true })) {
      try {
        const info = await stat(join(storageDir, key));
        files.push({ key: key.replaceAll("\\", "/"), size: info.size, lastModified: info.mtime });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return files.sort((a, b) => a.key.localeCompare(b.key));
}

function databaseSize(db: Database): number {
  const { page_count } = db.query("PRAGMA page_count").get() as { page_count: number };
  const { page_size } = db.query("PRAGMA page_size").get() as { page_size: number };
  return page_count * page_size;
}

/** Bytes of the database and all stored files, about the size of the export (files are stored uncompressed). */
export async function archiveExportSize(db: Database, storageDir: string): Promise<number> {
  return databaseSize(db) + (await storedFiles(storageDir)).reduce((sum, file) => sum + file.size, 0);
}

/**
 * A zip with a consistent snapshot of the whole database (all users) as `archivar.sqlite` and every stored file
 * (originals and derived files) under `files/`, the layout of the data directory: unzipped there it restores the archive.
 */
export function exportArchive(db: Database, storageDir: string): ReadableStream<Uint8Array> {
  const snapshot = db.serialize();
  const now = new Date();
  async function* entries() {
    yield { name: EXPORT_DATABASE_NAME, input: snapshot, lastModified: now };
    for (const file of await storedFiles(storageDir)) {
      const data = Bun.file(join(storageDir, file.key));
      // Derived files can be removed while the export runs; they are regenerated on demand.
      if (!(await data.exists())) continue;
      yield { name: `${EXPORT_FILES_DIR}/${file.key}`, input: data.stream(), lastModified: file.lastModified };
    }
  }
  return makeZip(entries());
}

export function exportFilename(date = new Date()): string {
  return `archivar-${date.toISOString().slice(0, 10)}.zip`;
}
