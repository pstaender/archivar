import type { Shape } from "./shapes";
export interface Point {
  x: number;
  y: number;
}

export type Quad = [Point, Point, Point, Point];

export type ColorMode = "color" | "grayscale" | "bw";

export type Rotation = 0 | 90 | 180 | 270;

export interface DewarpGrid {
  rotation: Rotation;
  columns: number;
  rows: number;
  points: number[];
}

export interface EditSettings {
  rotation: Rotation;
  dewarp: DewarpGrid | null;
  corners: Quad | null;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  colorMode: ColorMode;
  /** Weights per hue for grayscale (percent); null converts by brightness. */
  grayMix: GrayMix | null;
  /** Grayscale only: the mixed gray becomes black and white at this value (0..255); null keeps the gray tones. */
  grayThreshold: number | null;
  bwThreshold: number;
  denoise: number;
  autoLevels: boolean;
}

export interface GrayMix {
  reds: number;
  yellows: number;
  greens: number;
  cyans: number;
  blues: number;
  magentas: number;
}

export interface BwVariant {
  brightness: number;
  contrast: number;
  bwThreshold: number;
}

export type DocumentKind = "image" | "pdf" | "file";

export type OcrStatus = "none" | "pending" | "running" | "done" | "failed";

export interface User {
  id: number;
  name: string;
  /** May export the whole archive. */
  admin: boolean;
}

export interface Folder {
  id: number;
  path: string;
  documentCount: number;
  stackCount: number;
}

export interface ArchiveDocument {
  id: number;
  title: string;
  originalName: string;
  mimeType: string;
  kind: DocumentKind;
  size: number;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  stackId: number | null;
  stackPosition: number;
  editSettings: EditSettings;
  /** Drawn onto the edited image (only images). */
  shapes: Shape[];
  /** Rotation, crop or dewarping changed after the shapes were drawn, so they may no longer cover the same content. */
  shapesOutdated: boolean;
  /** Areas replaced by vector graphics (only images; the areas themselves come from `/api/documents/:id/vectors`). */
  vectorCount: number;
  /** Rotation, crop or dewarping changed after the areas were vectorized. */
  vectorsOutdated: boolean;
  ocrText: string;
  ocrStatus: OcrStatus;
  ocrConfidence: number | null;
  ocrError: string | null;
  /** Text parts dropped as probable noise by the last OCR run. */
  ocrRemoved: number;
  /** The last OCR run kept all text parts, also unsure ones. */
  ocrAllText: boolean;
  /** Language detected in the text (Tesseract code, e.g. "deu"), null if unclear. */
  ocrLanguage: string | null;
  /** Languages chosen for text recognition; null uses the server's default languages. */
  ocrLanguages: string[] | null;
  metadata: Record<string, unknown>;
  folders: string[];
  /** The document this one was duplicated from; both use its original file. */
  copyOf: DocumentRef | null;
  /** Duplicates that use this document's original file. */
  copies: DocumentRef[];
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRef {
  id: number;
  title: string;
}

/** Upload response: also names the documents that already had the same file content (SHA-256). */
export interface UploadedDocument extends ArchiveDocument {
  duplicates: DocumentRef[];
}

export interface Stack {
  id: number;
  title: string;
  folders: string[];
  documentIds: number[];
  coverDocumentId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StackWithDocuments extends Stack {
  documents: ArchiveDocument[];
}

export type LibraryItem =
  | { type: "document"; document: ArchiveDocument }
  | { type: "stack"; stack: Stack };

export interface DocumentUpdate {
  title?: string;
  editSettings?: Partial<EditSettings>;
  shapes?: Shape[];
  ocrText?: string;
  folders?: string[];
}

export interface StackCreate {
  title?: string;
  documentIds: number[];
  folders?: string[];
}

export interface StackUpdate {
  title?: string;
  folders?: string[];
  documentIds?: number[];
}

/** "custom" is the order the user arranged in a folder (only with `folder`); the default is "updated". */
export type LibrarySort = "updated" | "created-desc" | "created-asc" | "title-asc" | "title-desc" | "custom";

export const LIBRARY_SORTS: LibrarySort[] = ["updated", "created-desc", "created-asc", "title-asc", "title-desc", "custom"];

export interface LibraryQuery {
  folder?: string;
  q?: string;
  sort?: LibrarySort;
}

export interface LibraryItemRef {
  type: LibraryItem["type"];
  id: number;
}

export interface AppConfig {
  dewarpAvailable: boolean;
  autoCropAvailable: boolean;
  convertibleImageTypes: string[];
  /** Languages used for text recognition unless a document has its own. */
  ocrLanguages: string[];
}

export interface ApiError {
  error: string;
}
