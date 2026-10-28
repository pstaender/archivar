import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import type { ArchiveDocument } from "../../shared/types";
import { type FetchMock, makeDocument, mockFetch, renderApp } from "../../../test/client";
import { rememberDocumentOrder, rememberLibraryLocation } from "../documentOrder";
import { DocumentPage } from "./DocumentPage";

let fetchMock: FetchMock;
afterEach(() => {
  fetchMock.restore();
  localStorage.clear();
  sessionStorage.clear();
});

const docs = new Map<number, ArchiveDocument>([1, 2, 3].map((id) => [id, makeDocument({ id, title: `Dokument ${id}` })]));

async function open(path: string, routes: Parameters<typeof mockFetch>[0] = {}) {
  fetchMock = mockFetch({
    ...routes,
    "GET /api/config": () => ({ dewarpAvailable: false, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
    "GET /api/settings": () => DEFAULT_USER_SETTINGS,
    "GET /api/folders": () => [],
    ...Object.fromEntries([...docs].map(([id, doc]) => [`GET /api/documents/${id}`, () => doc])),
  });
  const view = await renderApp(<DocumentPage />, { path, route: "/documents/:id" });
  await waitFor(() => expect(screen.getAllByRole("tab").length).toBeGreaterThan(0));
  return view;
}

const location = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;

describe("document navigation", () => {
  test("steps through the documents of the library page with the arrow keys", async () => {
    rememberDocumentOrder([1, 2, 3]);
    const { router } = await open("/documents/2");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(location(router)).toBe("/documents/3"));
    expect((screen.getByRole("button", { name: "Nächstes Dokument" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(location(router)).toBe("/documents/3");
    fireEvent.click(screen.getByRole("button", { name: "Vorheriges Dokument" }));
    await waitFor(() => expect(location(router)).toBe("/documents/2"));
  });

  test("leaves the arrow keys to text fields and ignores them with modifiers", async () => {
    rememberDocumentOrder([1, 2, 3]);
    const { router } = await open("/documents/2");
    for (const field of screen.getAllByRole("textbox")) fireEvent.keyDown(field, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft", metaKey: true });
    expect(location(router)).toBe("/documents/2");
  });

  test("steps through the pages of a stack", async () => {
    rememberDocumentOrder([1, 2, 3]);
    const { router } = await open("/documents/1?stack=9", {
      "GET /api/stacks/9": () => ({ id: 9, title: "Stapel", documentIds: [3, 1], documents: [docs.get(3), docs.get(1)], folders: [], createdAt: "", updatedAt: "" }),
    });
    await screen.findByText(/Seite 2 von 2/);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(location(router)).toBe("/documents/1?stack=9");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    await waitFor(() => expect(location(router)).toBe("/documents/3?stack=9"));
  });

  test("has no previous or next document when opened from elsewhere", async () => {
    await open("/documents/2");
    expect(screen.queryByRole("button", { name: "Nächstes Dokument" })).toBeNull();
  });

  test("goes back to the library page it came from, marking the document to scroll to", async () => {
    rememberLibraryLocation("/folders/wichtig?smart=1-2");
    await open("/documents/2");
    expect(screen.getByRole("link", { name: "Zurück" }).getAttribute("href")).toBe("/folders/wichtig?smart=1-2#2");
  });

  test("goes back to the stack it came from", async () => {
    rememberLibraryLocation("/folders/wichtig");
    await open("/documents/1?stack=9", {
      "GET /api/stacks/9": () => ({ id: 9, title: "Stapel", documentIds: [1], documents: [docs.get(1)], folders: [], createdAt: "", updatedAt: "" }),
    });
    expect(screen.getByRole("link", { name: "Zurück" }).getAttribute("href")).toBe("/stacks/9#1");
  });

  test("goes back to the overview without a remembered library page", async () => {
    await open("/documents/3");
    expect(screen.getByRole("link", { name: "Zurück" }).getAttribute("href")).toBe("/#3");
  });

  test("remembers the chosen tab for all documents", async () => {
    const first = await open("/documents/1");
    expect(screen.getByRole("tab", { name: "Text" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Datei" }));
    first.unmount();
    fetchMock.restore();
    await open("/documents/2");
    expect(screen.getByRole("tab", { name: "Datei" }).getAttribute("aria-selected")).toBe("true");
  });
  test("goes back to the library page with Escape, but only when it was opened from one", async () => {
    rememberLibraryLocation("/folders/steuer?sort=title");
    const { router } = await open("/documents/2");
    fireEvent.keyDown(screen.getAllByRole("textbox")[0]!, { key: "Escape" });
    expect(location(router)).toBe("/documents/2");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname + router.state.location.search + router.state.location.hash).toBe("/folders/steuer?sort=title#2"));
  });

  test("goes back to the stack with Escape", async () => {
    const { router } = await open("/documents/1?stack=9", {
      "GET /api/stacks/9": () => ({ id: 9, title: "Stapel", documentIds: [1], documents: [docs.get(1)], folders: [], createdAt: "", updatedAt: "" }),
    });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(location(router)).toBe("/stacks/9"));
  });

  test("stays on a document opened directly when Escape is pressed", async () => {
    const { router } = await open("/documents/2");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(location(router)).toBe("/documents/2");
  });
});
