import { describe, expect, test } from "bun:test";
import { folderFromPathname, folderHref, isLibraryPath } from "./routes";

describe("folder routes", () => {
  test("round-trips nested paths with special characters", () => {
    const path = "wichtig/2026/Miete & Nebenkosten?#";
    const href = folderHref(path);
    expect(href).toBe("/folders/wichtig/2026/Miete%20%26%20Nebenkosten%3F%23");
    expect(folderFromPathname(href)).toBe(path);
  });

  test("keeps a search query", () => {
    expect(folderHref("privat", "q=miete")).toBe("/folders/privat?q=miete");
  });

  test("ignores other routes and broken encodings", () => {
    expect(folderFromPathname("/stacks/1")).toBeNull();
    expect(folderFromPathname("/folders/")).toBeNull();
    expect(folderFromPathname("/folders/%E0%A4%A")).toBeNull();
    expect(isLibraryPath("/")).toBe(true);
    expect(isLibraryPath("/folders/a")).toBe(true);
    expect(isLibraryPath("/documents/1")).toBe(false);
  });
});
