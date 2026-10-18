/** Languages offered for text recognition, as Tesseract language codes (ISO 639-3, except "nor"). */
export const OCR_LANGUAGES: string[] = ["deu", "eng", "fra", "ita", "spa", "por", "nld", "dan", "swe", "nor", "fin", "pol", "ces", "slk", "hun", "ron", "hrv", "tur", "ell", "rus", "ukr"];

export function isOcrLanguage(code: unknown): code is string {
  return typeof code === "string" && OCR_LANGUAGES.includes(code);
}
