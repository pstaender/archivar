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
  bwThreshold: number;
  denoise: number;
  autoLevels: boolean;
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
  metadata: Record<string, unknown>;
  folders: string[];
  createdAt: string;
  updatedAt: string;
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

export interface LibraryQuery {
  folder?: string;
  q?: string;
}

export interface AppConfig {
  dewarpAvailable: boolean;
}

export interface ApiError {
  error: string;
}
