import { expect, test } from "bun:test";
import { ApiRequestError } from "./api";
import { i18n } from "./i18n";
import { translateServerMessage, translateWorkerError } from "./serverMessages";

test("translates server messages with their quoted names and numbers", async () => {
  expect(translateServerMessage('"scan.pdf" could not be read as a PDF')).toBe("„scan.pdf“ konnte nicht als PDF gelesen werden");
  expect(translateServerMessage('Already stored as "a", "b"')).toBe("Bereits vorhanden als „a“, „b“");
  expect(translateServerMessage("The password needs at least 8 characters")).toBe("Das Kennwort braucht mindestens 8 Zeichen");
  expect(translateServerMessage("Tesseract crashed")).toBe("Tesseract crashed");
  await i18n.changeLanguage("fr");
  expect(translateServerMessage("Document not found")).toBe("Document introuvable");
});

test("API errors keep the server's English message next to the translated one", () => {
  const error = new ApiRequestError(404, "Document not found");
  expect(error.message).toBe("Dokument nicht gefunden");
  expect(error.serverMessage).toBe("Document not found");
});

test("worker errors are translated, other errors are left alone", () => {
  expect((translateWorkerError(new Error("The image could not be loaded (404)")) as Error).message).toBe("Bild konnte nicht geladen werden (404)");
  const apiError = new ApiRequestError(404, "Document not found");
  expect(translateWorkerError(apiError)).toBe(apiError);
});
