import { expect, test } from "bun:test";
import { detectLanguage } from "./language";

test("detects the language of recognized text", () => {
  expect(detectLanguage("Sehr geehrte Damen und Herren, hiermit bestätigen wir den Eingang Ihrer Unterlagen.")).toBe("deu");
  expect(detectLanguage("Dear Sir or Madam, we hereby confirm that we have received your documents.")).toBe("eng");
  expect(detectLanguage("Madame, Monsieur, nous accusons réception de vos documents et vous remercions.")).toBe("fra");
  expect(detectLanguage("Italien hat ganz unterschiedliche Landschaften. Es gibt hohe Berge im Norden.")).toBe("deu");
  expect(detectLanguage("Estimados señores, por la presente confirmamos la recepción de sus documentos.")).toBe("spa");
});

test("returns null for short or empty text", () => {
  expect(detectLanguage("")).toBeNull();
  expect(detectLanguage("Rechnung 12")).toBeNull();
});
