import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { createI18n } from "../shared/i18n";

export const LANGUAGE_STORAGE_KEY = "archivar.language";

export const i18n = createI18n(
  {
    detection: { order: ["localStorage", "navigator"], lookupLocalStorage: LANGUAGE_STORAGE_KEY, caches: ["localStorage"] },
  },
  [LanguageDetector, initReactI18next],
);

export const t = i18n.t.bind(i18n);

/** The UI language for `Intl` formatting. */
export const locale = () => i18n.resolvedLanguage ?? i18n.language;

const syncDocumentLanguage = () => {
  if (typeof document !== "undefined") document.documentElement.lang = locale();
};
syncDocumentLanguage();
i18n.on("languageChanged", syncDocumentLanguage);
