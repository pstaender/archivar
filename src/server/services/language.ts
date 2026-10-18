import { franc } from "franc";
import { OCR_LANGUAGES } from "../../shared/languages";

// franc names Norwegian (Bokmål) "nob", Tesseract "nor".
const FRANC_TO_TESSERACT: Record<string, string> = { nob: "nor" };
const CANDIDATES = OCR_LANGUAGES.map((code) => (code === "nor" ? "nob" : code));
// Shorter texts (a few misread words) give random results.
const MIN_LENGTH = 20;

/** The language of a recognized text among the OCR languages, or null if it is too short or unclear. */
export function detectLanguage(text: string): string | null {
  const code = franc(text, { only: CANDIDATES, minLength: MIN_LENGTH });
  return code === "und" ? null : (FRANC_TO_TESSERACT[code] ?? code);
}
