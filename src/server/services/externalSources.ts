import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import {
  EXTERNAL_SOURCE_TYPES,
  type ExternalImportOptions,
  type ExternalImportRequest,
  type ExternalListing,
  type ExternalSource,
  type ExternalSourceInput,
  type ExternalSourceType,
  externalImportFolders,
  isListedFile,
  normalizeExternalPath,
} from "../../shared/externalSources";
import { normalizeFolderPath } from "../../shared/folders";
import { ALREADY_IMPORTED_NOTE, duplicateNote } from "../../shared/jobs";
import type { User } from "../../shared/types";
import type { ExternalSourceRepository, StoredExternalSource } from "../db/externalSources";
import { toPublicSource } from "../db/externalSources";
import type { JobItemCreate, JobRepository } from "../db/jobs";
import type { PresetRepository } from "../db/presets";
import type { UserRepository } from "../db/users";
import { HttpError } from "../http";
import type { ArchiveService } from "./archive";

export const MAX_IMPORT_FILES = 10_000;
// Symbolic links can make a folder contain itself.
const MAX_FOLDER_DEPTH = 32;

export interface ExternalFile {
  name: string;
  /** Relative to the source, separated by "/". */
  path: string;
  kind: "folder" | "file";
  size: number;
  modifiedAt: string | null;
  /** The earlier of birth and modification time, like `upload.sh` sends it. */
  createdAt: string | null;
}

/** Read access to an external data source; nothing is ever written to it. */
export interface ExternalSourceDriver {
  /** The folder's entries without hidden ones, sorted by name. */
  list(path: string): Promise<ExternalFile[]>;
  stat(path: string): Promise<ExternalFile>;
  read(path: string): Promise<Uint8Array>;
}

const byName = (a: ExternalFile, b: ExternalFile) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

function timeOf(ms: number): string | null {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/** A folder on the server. Paths are resolved through symbolic links and must stay inside it. */
export class FilePathSource implements ExternalSourceDriver {
  constructor(private root: string) {}

  private async realRoot(): Promise<string> {
    try {
      return await realpath(this.root);
    } catch {
      throw new HttpError(404, "The data source is not reachable");
    }
  }

  private async resolve(path: string): Promise<{ full: string; relative: string }> {
    const relative = normalizeExternalPath(path);
    if (relative === null) throw new HttpError(400, "Invalid path");
    const root = await this.realRoot();
    const full = await realpath(join(root, relative)).catch(() => null);
    if (full === null) throw new HttpError(404, "File not found");
    if (full !== root && !full.startsWith(root + sep)) throw new HttpError(400, "Invalid path");
    return { full, relative };
  }

  private async describe(full: string, relative: string): Promise<ExternalFile> {
    const info = await stat(full);
    const name = relative.slice(relative.lastIndexOf("/") + 1);
    const created = Math.min(...[info.birthtimeMs, info.mtimeMs].filter((ms) => ms > 0));
    return {
      name,
      path: relative,
      kind: info.isDirectory() ? "folder" : "file",
      size: info.isDirectory() ? 0 : info.size,
      modifiedAt: timeOf(info.mtimeMs),
      createdAt: timeOf(created),
    };
  }

  async list(path: string): Promise<ExternalFile[]> {
    const { full, relative } = await this.resolve(path);
    if (!(await stat(full)).isDirectory()) throw new HttpError(404, "Folder not found");
    const root = await this.realRoot();
    const entries: ExternalFile[] = [];
    for (const name of await readdir(full)) {
      if (name.startsWith(".")) continue;
      const target = await realpath(join(full, name)).catch(() => null);
      if (target === null || !target.startsWith(root + sep)) continue;
      const entry = await this.describe(target, relative ? `${relative}/${name}` : name).catch(() => null);
      if (entry) entries.push({ ...entry, name });
    }
    return entries.sort(byName);
  }

  async stat(path: string): Promise<ExternalFile> {
    const { full, relative } = await this.resolve(path);
    return this.describe(full, relative);
  }

  async read(path: string): Promise<Uint8Array> {
    const { full } = await this.resolve(path);
    return new Uint8Array(await Bun.file(full).arrayBuffer());
  }
}

export function openSource(source: Pick<ExternalSource, "type" | "url">): ExternalSourceDriver {
  switch (source.type) {
    case "file_path":
      return new FilePathSource(source.url);
  }
}

/** The files of a folder (and its sub-folders) that pass `include`, in name order, folder by folder. */
async function collectFiles(driver: ExternalSourceDriver, folder: string, recursive: boolean, include: (file: ExternalFile) => boolean): Promise<ExternalFile[]> {
  const found: ExternalFile[] = [];
  const visit = async (path: string, depth: number) => {
    const entries = await driver.list(path);
    for (const entry of entries) {
      if (entry.kind === "file" && include(entry)) found.push(entry);
      if (found.length > MAX_IMPORT_FILES) throw new HttpError(400, `Too many files, at most ${MAX_IMPORT_FILES} can be imported at once`);
    }
    if (!recursive || depth >= MAX_FOLDER_DEPTH) return;
    for (const entry of entries) if (entry.kind === "folder") await visit(entry.path, depth + 1);
  };
  await visit(folder, 0);
  return found;
}

function normalizePaths(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "Invalid path");
  return value.map((path) => {
    const normalized = typeof path === "string" ? normalizeExternalPath(path) : null;
    if (normalized === null) throw new HttpError(400, "Invalid path");
    return normalized;
  });
}

function normalizeCredentials(value: unknown): Record<string, string> | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid credentials");
  const entries = Object.entries(value).map(([key, item]) => [key, String(item)] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

async function normalizeUrl(type: ExternalSourceType, value: unknown): Promise<string> {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url) throw new HttpError(400, "Path required");
  if (!isAbsolute(url)) throw new HttpError(400, "The path must be absolute");
  const path = resolve(url);
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw new HttpError(404, "Folder not found");
  return path;
}

export class ExternalSourceService {
  constructor(
    private sources: ExternalSourceRepository,
    private jobs: JobRepository,
    private archive: ArchiveService,
    private users: UserRepository,
    private presets: PresetRepository,
    private convertibleTypes: () => string[],
  ) {}

  list(userId: number): ExternalSource[] {
    return this.sources.list(userId).map(toPublicSource);
  }

  private get(userId: number, id: number): StoredExternalSource {
    const source = this.sources.get(userId, id);
    if (!source) throw new HttpError(404, "Data source not found");
    return source;
  }

  // A path on the server can expose any file the server may read, so only admins set sources up.
  private requireAdmin(user: User): void {
    if (!user.admin) throw new HttpError(403, "Only admins can set up data sources");
  }

  async create(user: User, input: ExternalSourceInput): Promise<ExternalSource> {
    this.requireAdmin(user);
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 100) : "";
    if (!name) throw new HttpError(400, "Name required");
    const type = input.type ?? "file_path";
    if (!EXTERNAL_SOURCE_TYPES.includes(type)) throw new HttpError(400, "Unknown data source type");
    const url = await normalizeUrl(type, input.url);
    return toPublicSource(this.sources.create(user.id, { name, type, url, credentials: normalizeCredentials(input.credentials) ?? null }));
  }

  async update(user: User, id: number, input: ExternalSourceInput): Promise<ExternalSource> {
    this.requireAdmin(user);
    const source = this.get(user.id, id);
    const name = input.name === undefined ? undefined : String(input.name).trim().slice(0, 100);
    if (name === "") throw new HttpError(400, "Name required");
    const url = input.url === undefined ? undefined : await normalizeUrl(source.type, input.url);
    return toPublicSource(this.sources.update(user.id, id, { name, url, credentials: normalizeCredentials(input.credentials) })!);
  }

  delete(userId: number, id: number): void {
    if (!this.sources.delete(userId, id)) throw new HttpError(404, "Data source not found");
  }

  async browse(userId: number, id: number, path: string, allFiles: boolean): Promise<ExternalListing> {
    const source = this.get(userId, id);
    const folder = normalizeExternalPath(path);
    if (folder === null) throw new HttpError(400, "Invalid path");
    const entries = await openSource(source).list(folder);
    const files = entries.filter((entry) => entry.kind === "file");
    const shown = allFiles ? files : files.filter((file) => isListedFile(file, this.convertibleTypes()));
    const imported = this.sources.importedDocuments(source.id, shown.map((file) => file.path));
    return {
      path: folder,
      entries: [...entries.filter((entry) => entry.kind === "folder"), ...shown].map((entry) => ({
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        size: entry.kind === "file" ? entry.size : null,
        modifiedAt: entry.modifiedAt,
        documentId: imported.get(entry.path) ?? null,
      })),
      hidden: files.length - shown.length,
    };
  }

  /** Creates an external import job; files found in folders that were imported before are skipped. Returns the job id. */
  async startImport(userId: number, id: number, request: ExternalImportRequest): Promise<number> {
    const source = this.get(userId, id);
    const driver = openSource(source);
    const filePaths = normalizePaths(request.files);
    const folderPaths = normalizePaths(request.folders);
    const base = normalizeExternalPath(typeof request.base === "string" ? request.base : "");
    if (base === null) throw new HttpError(400, "Invalid path");
    if (!Array.isArray(request.targetFolders ?? [])) throw new HttpError(400, "Invalid folder");
    const targetFolders = [...new Set((request.targetFolders ?? []).map((folder) => normalizeFolderPath(String(folder))).filter(Boolean))];

    const chosen: ExternalFile[] = [];
    for (const path of filePaths) {
      const file = await driver.stat(path);
      if (file.kind !== "file") throw new HttpError(404, "File not found");
      chosen.push(file);
    }
    const include = (file: ExternalFile) => request.allFiles === true || isListedFile(file, this.convertibleTypes());
    const found: ExternalFile[] = [];
    for (const folder of folderPaths) found.push(...(await collectFiles(driver, folder, request.recursive === true, include)));

    const seen = new Set(chosen.map((file) => file.path));
    const inFolders = found.filter((file) => !seen.has(file.path) && seen.add(file.path));
    if (chosen.length + inFolders.length === 0) throw new HttpError(400, "No files to import");
    if (chosen.length + inFolders.length > MAX_IMPORT_FILES) throw new HttpError(400, `Too many files, at most ${MAX_IMPORT_FILES} can be imported at once`);

    const imported = this.sources.importedDocuments(source.id, inFolders.map((file) => file.path));
    const items: JobItemCreate[] = [
      ...chosen.map((file) => ({ name: file.path, documentId: null, sourcePath: file.path })),
      ...inFolders.map((file): JobItemCreate => {
        const documentId = imported.get(file.path);
        return documentId === undefined
          ? { name: file.path, documentId: null, sourcePath: file.path }
          : { name: file.path, documentId, sourcePath: file.path, status: "skipped", note: ALREADY_IMPORTED_NOTE };
      }),
    ];

    const settings = this.users.settings(userId);
    const preset = settings.importPresetId === null ? null : this.presets.get(userId, settings.importPresetId);
    const options: ExternalImportOptions = {
      source: { id: source.id, name: source.name },
      base,
      keepStructure: request.keepStructure === true,
      targetFolders,
      importFolders: settings.importFolders,
      ocr: settings.autoOcr,
      ocrAllText: settings.ocrAllText,
      preset: preset ? { name: preset.name, steps: preset.steps } : null,
      ocrLanguages: settings.importOcrLanguages,
    };
    return this.jobs.create(userId, "external", options, items);
  }

  /** Copies one file into the archive like an upload and links the document to its source. */
  async importFile(userId: number, options: ExternalImportOptions, path: string): Promise<{ documentId: number; ocr: boolean; note?: string }> {
    const source = this.get(userId, options.source.id);
    const driver = openSource(source);
    const file = await driver.stat(path);
    if (file.kind !== "file") throw new HttpError(404, "File not found");
    const [doc] = await this.archive.upload(userId, [{ name: file.name, type: "", data: await driver.read(path) }], {
      folders: externalImportFolders(options, path),
      runOcr: options.ocr,
      ocrAllText: options.ocrAllText,
      preset: options.preset?.steps,
      ocrLanguages: options.ocrLanguages,
      createdAt: file.createdAt ?? undefined,
    });
    this.sources.link(doc!.id, source.id, { path: file.path, size: file.size, modifiedAt: file.modifiedAt });
    return { documentId: doc!.id, ocr: doc!.ocrStatus === "pending", note: doc!.duplicates.length ? duplicateNote(doc!.duplicates) : undefined };
  }
}
