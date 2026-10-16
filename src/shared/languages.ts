/** Languages offered for text recognition, as Tesseract language codes (ISO 639-3, except "nor"). */
export const OCR_LANGUAGES: { code: string; name: string }[] = [
  { code: "deu", name: "Deutsch" },
  { code: "eng", name: "Englisch" },
  { code: "fra", name: "Französisch" },
  { code: "ita", name: "Italienisch" },
  { code: "spa", name: "Spanisch" },
  { code: "por", name: "Portugiesisch" },
  { code: "nld", name: "Niederländisch" },
  { code: "dan", name: "Dänisch" },
  { code: "swe", name: "Schwedisch" },
  { code: "nor", name: "Norwegisch" },
  { code: "fin", name: "Finnisch" },
  { code: "pol", name: "Polnisch" },
  { code: "ces", name: "Tschechisch" },
  { code: "slk", name: "Slowakisch" },
  { code: "hun", name: "Ungarisch" },
  { code: "ron", name: "Rumänisch" },
  { code: "hrv", name: "Kroatisch" },
  { code: "tur", name: "Türkisch" },
  { code: "ell", name: "Griechisch" },
  { code: "rus", name: "Russisch" },
  { code: "ukr", name: "Ukrainisch" },
];

export function languageName(code: string): string {
  return OCR_LANGUAGES.find((language) => language.code === code)?.name ?? code;
}

export function isOcrLanguage(code: unknown): code is string {
  return typeof code === "string" && OCR_LANGUAGES.some((language) => language.code === code);
}
