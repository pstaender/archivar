import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

const { afterEach } = await import("bun:test");
const { cleanup } = await import("@testing-library/react");
const { i18n } = await import("../src/client/i18n");

// The tests assert the German texts.
await i18n.changeLanguage("de");

afterEach(async () => {
  cleanup();
  localStorage.clear();
  if (i18n.language !== "de") await i18n.changeLanguage("de");
});
