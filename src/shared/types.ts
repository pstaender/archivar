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
  createdAt: string;
  updatedAt: string;
}

/** Upload response: also names the documents that already had the same file content (SHA-256). */
export interface UploadedDocument extends ArchiveDocument {
  duplicates: { id: number; title: string }[];
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
  convertibleImageTypes: string[];
  /** Languages used for text recognition unless a document has its own. */
  ocrLanguages: string[];
}

export interface ApiError {
  error: string;
}
