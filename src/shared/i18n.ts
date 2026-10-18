import { createInstance, type i18n, type InitOptions } from "i18next";
import de from "../../i18n/de.yml";
import en from "../../i18n/en.yml";
import es from "../../i18n/es.yml";
import fr from "../../i18n/fr.yml";

export const UI_LANGUAGES = [
  { code: "de", name: "Deutsch" },
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number]["code"];

export const DEFAULT_UI_LANGUAGE: UiLanguage = "en";

export const translations: Record<UiLanguage, Record<string, unknown>> = { de, en, fr, es };

export function createI18n(options: InitOptions = {}, plugins: Parameters<i18n["use"]>[0][] = []): i18n {
  const instance = createInstance();
  for (const plugin of plugins) instance.use(plugin);
  void instance.init({
    resources: Object.fromEntries(Object.entries(translations).map(([code, translation]) => [code, { translation }])),
    supportedLngs: UI_LANGUAGES.map((language) => language.code),
    nonExplicitSupportedLngs: true,
    fallbackLng: DEFAULT_UI_LANGUAGE,
    interpolation: { escapeValue: false },
    initAsync: false,
    ...options,
  });
  return instance;
}
