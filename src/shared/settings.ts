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
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  autoOcr: true,
  autoDewarp: false,
  ocrAllText: false,
  uploadEnhancement: "bw",
  pdfImageQuality: "300",
});

const UPLOAD_ENHANCEMENTS: UploadEnhancement[] = ["bw", "grayscale", "color", "original"];
const PDF_IMAGE_QUALITIES: PdfImageQuality[] = ["300", "150", "original"];

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const oneOf = <T extends string>(values: T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);

export function normalizeUserSettings(input: unknown, base: UserSettings = DEFAULT_USER_SETTINGS): UserSettings {
  const src = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof UserSettings, unknown>>;
  return {
    autoOcr: flag(src.autoOcr, base.autoOcr),
    autoDewarp: flag(src.autoDewarp, base.autoDewarp),
    ocrAllText: flag(src.ocrAllText, base.ocrAllText),
    uploadEnhancement: oneOf(UPLOAD_ENHANCEMENTS, src.uploadEnhancement, base.uploadEnhancement),
    pdfImageQuality: oneOf(PDF_IMAGE_QUALITIES, src.pdfImageQuality, base.pdfImageQuality),
  };
}
