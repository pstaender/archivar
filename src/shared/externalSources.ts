import type { PresetSteps } from "./presets";
import { isSupportedUpload } from "./uploads";

/** Only paths on the server for now; S3 or Nextcloud would be further types. */
export const EXTERNAL_SOURCE_TYPES = ["file_path"] as const;
export type ExternalSourceType = (typeof EXTERNAL_SOURCE_TYPES)[number];

/** Larger files are only listed when all files are shown. */
export const MAX_LISTED_FILE_SIZE = 10 * 1024 * 1024;

export interface ExternalSource {
  id: number;
  name: string;
  type: ExternalSourceType;
  url: string;
  /** Credentials are stored on the server and never sent back. */
  hasCredentials: boolean;
  /** Documents imported from it that still exist. */
  documentCount: number;
  createdAt: string;
}

export interface ExternalSourceInput {
  name?: string;
  type?: ExternalSourceType;
  url?: string;
  credentials?: Record<string, string> | null;
}

export interface ExternalEntry {
  name: string;
  /** Relative to the source, separated by "/". */
  path: string;
  kind: "folder" | "file";
  size: number | null;
  modifiedAt: string | null;
  /** The document imported from this file (the oldest one still in the archive). */
  documentId: number | null;
}

export interface ExternalListing {
  path: string;
  entries: ExternalEntry[];
  /** Files left out by the filter (other types, too large). */
  hidden: number;
}

export interface ExternalImportRequest {
  /** Files to import, also when they were imported before. */
  files?: string[];
  /** Folders whose files are imported; files imported before are skipped. */
  folders?: string[];
  /** Also the files in the folders' sub-folders. */
  recursive?: boolean;
  /** Not only images and PDFs up to `MAX_LISTED_FILE_SIZE`. */
  allFiles?: boolean;
  /** Mirror the folders below `base` as archive folders. */
  keepStructure?: boolean;
  /** The folder being browsed. */
  base?: string;
  /** Archive folders every imported file is put into. */
  targetFolders?: string[];
}

/** What an import job does with each file; a snapshot of the user's import settings when it started. */
export interface ExternalImportOptions {
  source: { id: number; name: string };
  base: string;
  keepStructure: boolean;
  targetFolders: string[];
  importFolders: string[];
  ocr: boolean;
  ocrAllText: boolean;
  preset: { name: string; steps: PresetSteps } | null;
  ocrLanguages: string[] | null;
}

export function isListedFile(file: { name: string; size: number }, convertibleTypes: readonly string[]): boolean {
  return file.size <= MAX_LISTED_FILE_SIZE && isSupportedUpload({ name: file.name, type: "" }, convertibleTypes);
}

/** "/a//b/" → "a/b"; null for paths that would leave the source. */
export function normalizeExternalPath(path: string): string | null {
  const parts = path.split(/[/\\]+/).filter((part) => part && part !== ".");
  return parts.includes("..") ? null : parts.join("/");
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function folderBelow(base: string, dir: string): string {
  if (!base) return dir;
  return dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : "";
}

/** The archive folders of an imported file: the target folders (with the file's folders below `base` if kept) and the import folders. */
export function externalImportFolders(options: Pick<ExternalImportOptions, "base" | "keepStructure" | "targetFolders" | "importFolders">, path: string): string[] {
  const relative = options.keepStructure ? folderBelow(options.base, parentOf(path)) : "";
  const targets = options.targetFolders.length > 0 ? options.targetFolders.map((folder) => (relative ? `${folder}/${relative}` : folder)) : relative ? [relative] : [];
  return [...new Set([...targets, ...options.importFolders])];
}
