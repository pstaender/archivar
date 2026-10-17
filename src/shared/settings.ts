import { normalizeFolderPath } from "./folders";

/** Resolution of images in exported PDFs, relative to an A4 page; "original" embeds the edited image unchanged. */
export type PdfImageQuality = "300" | "150" | "original";

export interface UserSettings {
  /** Recognize text right after uploading. */
  autoOcr: boolean;
  /** Keep unsure, probably misread text parts. */
  ocrAllText: boolean;
  pdfImageQuality: PdfImageQuality;
  /** Image preset applied to every uploaded image. */
  importPresetId: number | null;
  /** Folders every upload is added to, besides the folder it was uploaded in. */
  importFolders: string[];
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  autoOcr: true,
  ocrAllText: false,
  pdfImageQuality: "300",
  importPresetId: null,
  importFolders: [],
});

const PDF_IMAGE_QUALITIES: PdfImageQuality[] = ["300", "150", "original"];

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const oneOf = <T extends string>(values: T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);

const presetId = (value: unknown): number | null => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : null);

const folderList = (values: unknown[]): string[] =>
  [...new Set(values.map((value) => (typeof value === "string" ? normalizeFolderPath(value) : "")).filter(Boolean))].sort();

export function normalizeUserSettings(input: unknown, base: UserSettings = DEFAULT_USER_SETTINGS): UserSettings {
  const src = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof UserSettings, unknown>>;
  return {
    autoOcr: flag(src.autoOcr, base.autoOcr),
    ocrAllText: flag(src.ocrAllText, base.ocrAllText),
    pdfImageQuality: oneOf(PDF_IMAGE_QUALITIES, src.pdfImageQuality, base.pdfImageQuality),
    importPresetId: "importPresetId" in src ? presetId(src.importPresetId) : base.importPresetId,
    importFolders: Array.isArray(src.importFolders) ? folderList(src.importFolders) : base.importFolders,
  };
}
