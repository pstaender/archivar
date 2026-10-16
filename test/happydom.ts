import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:3000/" });

const { afterEach } = await import("bun:test");
const { cleanup } = await import("@testing-library/react");

afterEach(() => {
  cleanup();
  localStorage.clear();
});
