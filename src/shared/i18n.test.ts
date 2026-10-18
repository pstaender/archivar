import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { createI18n, translations, UI_LANGUAGES } from "./i18n";

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
});
