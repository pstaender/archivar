import { normalizeFolderPath } from "./folders";

/** How uploads with automatic OCR are prepared before the text is recognized. */
export type UploadEnhancement = "bw" | "grayscale" | "color" | "original";
/** Resolution of images in exported PDFs, relative to an A4 page; "original" embeds the edited image unchanged. */
export type PdfImageQuality = "300" | "150" | "original";

export interface UserSettings {
  /** Recognize text right after uploading. */
  autoOcr: boolean;
  /** Dewarp photos before the text is recognized (needs the UVDoc model). */
  autoDewarp: boolean;
  /** Keep unsure, probably misread text parts. */
  ocrAllText: boolean;
  uploadEnhancement: UploadEnhancement;
  pdfImageQuality: PdfImageQuality;
  /** Image preset applied to every uploaded image instead of `uploadEnhancement`/`autoDewarp`. */
  importPresetId: number | null;
  /** Folders every upload is added to, besides the folder it was uploaded in. */
  importFolders: string[];
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  autoOcr: true,
  autoDewarp: false,
  ocrAllText: false,
  uploadEnhancement: "bw",
  pdfImageQuality: "300",
  importPresetId: null,
  importFolders: [],
});

const UPLOAD_ENHANCEMENTS: UploadEnhancement[] = ["bw", "grayscale", "color", "original"];
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
    autoDewarp: flag(src.autoDewarp, base.autoDewarp),
    ocrAllText: flag(src.ocrAllText, base.ocrAllText),
    uploadEnhancement: oneOf(UPLOAD_ENHANCEMENTS, src.uploadEnhancement, base.uploadEnhancement),
    pdfImageQuality: oneOf(PDF_IMAGE_QUALITIES, src.pdfImageQuality, base.pdfImageQuality),
    importPresetId: "importPresetId" in src ? presetId(src.importPresetId) : base.importPresetId,
    importFolders: Array.isArray(src.importFolders) ? folderList(src.importFolders) : base.importFolders,
  };
}
