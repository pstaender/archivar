import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { createI18n, translations, UI_LANGUAGES } from "./i18n";
import { duplicateNote } from "./jobs";
import { serverMessageParts } from "./serverMessages";

const PLURAL = /_(zero|one|two|few|many|other)$/;

function flatten(tree: Record<string, unknown>, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") for (const [k, v] of flatten(value as Record<string, unknown>, path)) entries.set(k, v);
    else entries.set(path, String(value));
  }
  return entries;
}

const baseKeys = (entries: Map<string, string>) => new Set([...entries.keys()].map((key) => key.replace(PLURAL, "")));
const placeholders = (text: string) => new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).filter((name) => name !== "count"));

describe("translations", () => {
  const german = flatten(translations.de);

  test.each(UI_LANGUAGES.map(({ code }) => code))("%s has the same keys and placeholders as German", (code) => {
    const entries = flatten(translations[code]);
    expect([...baseKeys(entries)].sort()).toEqual([...baseKeys(german)].sort());
    for (const [key, text] of entries) {
      const reference = german.get(key) ?? german.get(key.replace(PLURAL, "_other"));
      expect({ key, placeholders: [...placeholders(text)].sort() }).toEqual({ key, placeholders: [...placeholders(reference ?? "")].sort() });
    }
  });

  test("every key used in the code exists", async () => {
    const keys = baseKeys(german);
    const missing: string[] = [];
    for await (const file of new Glob("src/**/*.{ts,tsx}").scan(".")) {
      if (file.includes(".test.")) continue;
      const source = await Bun.file(file).text();
      for (const match of source.matchAll(/(?<![\w.])(?:t|i18n\.t)\("([\w.-]+)"/g)) if (!keys.has(match[1]!)) missing.push(`${file}: ${match[1]}`);
      for (const match of source.matchAll(/i18nKey="([\w.-]+)"/g)) if (!keys.has(match[1]!)) missing.push(`${file}: ${match[1]}`);
    }
    expect(missing).toEqual([]);
  });

  test("falls back to English for other languages", () => {
    expect(createI18n({ lng: "it" }).t("common.save")).toBe("Save");
    expect(createI18n({ lng: "de-AT" }).t("common.save")).toBe("Speichern");
  });

  test("every message the server sends can be translated", async () => {
    const patterns = [
      /HttpError\(\d+, (?:"([^"]+)"|`([^`]+)`)/g,
      /json\(\{ error: "([^"]+)" \}/g,
      /_MESSAGE = "([^"]+)"/g,
      /\?\? "([A-Z][^"]+)"/g,
      /new Error\("([^"]+)"\)/g,
    ];
    const messages = [duplicateNote([{ title: "a" }, { title: "b" }])];
    for await (const file of new Glob("src/server/**/*.ts").scan(".")) {
      if (file.includes(".test.") || (file.includes("/services/") && !file.endsWith("ocr.ts") && !file.endsWith("archive.ts") && !file.endsWith("auth.ts"))) continue;
      const source = await Bun.file(file).text();
      for (const pattern of patterns) for (const match of source.matchAll(pattern)) messages.push((match[1] ?? match[2]!).replace(/\$\{[^}]+\}/g, "0"));
    }
    const client = await Bun.file("src/client/api.ts").text();
    for (const match of client.matchAll(/(?:ApiRequestError\(\d+, |\|\| )"([^"]+)"/g)) messages.push(match[1]!);
    expect(messages.length).toBeGreaterThan(60);
    const keys = new Set(Object.keys(translations.de.serverMessages as object));
    expect(messages.filter((message) => !keys.has(serverMessageParts(message).key))).toEqual([]);
  });

  test("every message the workers send can be translated", async () => {
    const files = [
      "src/client/editor/preview.worker.ts",
      "src/client/editor/previewRenderer.ts",
      ...(await Array.fromAsync(new Glob("src/vectorizer/**/*.ts").scan("."))),
      ...(await Array.fromAsync(new Glob("src/shared/image/*.ts").scan("."))),
    ].filter((file) => !file.includes(".test."));
    const messages: string[] = [];
    for (const file of files) {
      const source = await Bun.file(file).text();
      for (const match of source.matchAll(/(?:new Error\(|\|\| )(?:"([^"]+)"|`([^`]+)`)/g)) messages.push((match[1] ?? match[2]!).replace(/\$\{[^}]+\}/g, "0"));
    }
    expect(messages.length).toBeGreaterThan(8);
    const keys = new Set(Object.keys(translations.de.workerMessages as object));
    expect(messages.filter((message) => !keys.has(serverMessageParts(message).key))).toEqual([]);
  });

  test("server message keys leave out quoted names and numbers", () => {
    expect(serverMessageParts('"scan 2.pdf" could not be read as a PDF')).toEqual({ key: "could_not_be_read_as_a_pdf", quoted: [["scan 2.pdf"]], numbers: [] });
    expect(serverMessageParts('Already stored as "a", "b"')).toEqual({ key: "already_stored_as", quoted: [["a", "b"]], numbers: [] });
    expect(serverMessageParts("The password needs at least 8 characters").key).toBe("the_password_needs_at_least_characters");
  });
});
