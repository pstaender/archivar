import { normalizeFolderPath } from "./folders";
import { isOcrLanguage } from "./languages";

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
  /** Languages for recognizing uploads; null detects the language and recognizes again if it is not a default one. */
  importOcrLanguages: string[] | null;
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  autoOcr: true,
  ocrAllText: false,
  pdfImageQuality: "300",
  importPresetId: null,
  importFolders: [],
  importOcrLanguages: null,
});

const PDF_IMAGE_QUALITIES: PdfImageQuality[] = ["300", "150", "original"];

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const oneOf = <T extends string>(values: T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);

const presetId = (value: unknown): number | null => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : null);

const languageList = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  const languages = [...new Set(value.filter(isOcrLanguage))];
  return languages.length > 0 ? languages : null;
};

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
    importOcrLanguages: "importOcrLanguages" in src ? languageList(src.importOcrLanguages) : base.importOcrLanguages,
  };
}
