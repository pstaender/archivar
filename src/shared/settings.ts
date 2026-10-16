/** How uploads with automatic OCR are prepared before the text is recognized. */
export type UploadEnhancement = "bw" | "grayscale" | "color" | "original";
/** Resolution of images in exported PDFs, relative to an A4 page; "original" embeds the edited image unchanged. */
export type PdfImageQuality = "300" | "150" | "original";

export interface UserSettings {
  uploadEnhancement: UploadEnhancement;
  pdfImageQuality: PdfImageQuality;
}

export const DEFAULT_USER_SETTINGS: UserSettings = Object.freeze({
  uploadEnhancement: "bw",
  pdfImageQuality: "300",
});

const UPLOAD_ENHANCEMENTS: UploadEnhancement[] = ["bw", "grayscale", "color", "original"];
const PDF_IMAGE_QUALITIES: PdfImageQuality[] = ["300", "150", "original"];

const oneOf = <T extends string>(values: T[], value: unknown, fallback: T): T => (values.includes(value as T) ? (value as T) : fallback);

export function normalizeUserSettings(input: unknown, base: UserSettings = DEFAULT_USER_SETTINGS): UserSettings {
  const src = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof UserSettings, unknown>>;
  return {
    uploadEnhancement: oneOf(UPLOAD_ENHANCEMENTS, src.uploadEnhancement, base.uploadEnhancement),
    pdfImageQuality: oneOf(PDF_IMAGE_QUALITIES, src.pdfImageQuality, base.pdfImageQuality),
  };
}
