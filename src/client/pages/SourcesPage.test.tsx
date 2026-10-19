import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import type { ExternalEntry, ExternalListing, ExternalSource } from "../../shared/externalSources";
import type { Job } from "../../shared/jobs";
import { type FetchMock, folder, mockFetch, renderApp } from "../../../test/client";
import { SourceBrowserPage } from "./SourceBrowserPage";
import { SourcesPage } from "./SourcesPage";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const source: ExternalSource = { id: 3, name: "Scanner", type: "file_path", url: "/mnt/scans", hasCredentials: false, documentCount: 2, createdAt: "" };

const entry = (path: string, kind: ExternalEntry["kind"], documentId: number | null = null): ExternalEntry => ({
  name: path.split("/").at(-1)!,
  path,
  kind,
  size: kind === "file" ? 2048 : null,
  modifiedAt: "2026-03-01T10:00:00.000Z",
  documentId,
});

const listings: Record<string, ExternalListing> = {
  "": { path: "", entries: [entry("2026", "folder"), entry("brief.jpg", "file", 7)], hidden: 2 },
  "2026": { path: "2026", entries: [entry("2026/rechnung.pdf", "file")], hidden: 0 },
};

function setup(ui: React.ReactElement, path: string, { admin = true } = {}) {
  let sources = [source];
  fetchMock = mockFetch({
    "GET /api/folders": () => [folder(1, "archiv")],
    "GET /api/config": () => ({}),
    "GET /api/settings": () => DEFAULT_USER_SETTINGS,
    "GET /api/auth/status": () => ({ user: { id: 1, name: "admin", admin }, passwordSet: false, usernameRequired: false, passkeyLogin: false }),
    "GET /api/sources": () => sources,
    "POST /api/sources": (_url, init) => {
      const created = { ...source, id: 4, documentCount: 0, ...JSON.parse(String(init.body)) };
      sources = [...sources, created];
      return created;
    },
    "DELETE /api/sources/3": () => {
      sources = [];
      return undefined;
    },
    "GET /api/sources/3/browse": (url) => listings[url.searchParams.get("path") ?? ""],
    "POST /api/sources/3/import": (): Job => ({
      id: 9,
      kind: "external",
      options: null,
      source: { id: 3, name: "Scanner" },
      createdAt: "",
      active: true,
      finishedAt: null,
      items: [
        { id: 1, name: "2026/rechnung.pdf", state: "pending", error: null, note: null, document: null },
        { id: 2, name: "brief.jpg", state: "skipped", error: null, note: "Already imported", document: null },
      ],
    }),
  });
  return renderApp(ui, { path, route: path.startsWith("/sources/") ? "/sources/:id" : "*" });
}

describe("SourcesPage", () => {
  test("lists the sources and lets admins add one", async () => {
    await setup(<SourcesPage />, "/sources");
    expect(screen.getByRole("link", { name: "Scanner" })).toBeTruthy();
    expect(screen.getByText(/2 Dokumente importiert/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "NAS" } });
    fireEvent.change(screen.getByLabelText("Ordner auf dem Server"), { target: { value: "/srv/nas" } });
    fireEvent.click(screen.getByRole("button", { name: "Datenquelle hinzufügen" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "NAS" })).toBeTruthy());
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ name: "NAS", type: "file_path", url: "/srv/nas" });
  });

  test("others cannot add sources", async () => {
    await setup(<SourcesPage />, "/sources", { admin: false });
    expect(screen.queryByRole("button", { name: "Datenquelle hinzufügen" })).toBeNull();
    expect(screen.getByText("Nur Admins können Datenquellen einrichten.")).toBeTruthy();
  });

  test("deletes a source after asking", async () => {
    await setup(<SourcesPage />, "/sources");
    fireEvent.click(screen.getByRole("button", { name: "Scanner löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(screen.getByText("Noch keine Datenquellen.")).toBeTruthy());
  });
});

describe("SourceBrowserPage", () => {
  test("browses folders, marks imported files and imports the selection with its options", async () => {
    const { router } = await setup(<SourceBrowserPage />, "/sources/3");
    expect(screen.getByRole("heading", { name: "Scanner" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Bereits importiert" }).getAttribute("href")).toBe("/documents/7");
    expect(screen.getByText(/2 weitere Dateien ausgeblendet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "brief.jpg auswählen" }));
    fireEvent.click(screen.getByRole("link", { name: "2026" }));
    await waitFor(() => expect(router.state.location.search).toBe("?path=2026"));
    await waitFor(() => expect(screen.getByText("rechnung.pdf")).toBeTruthy());
    fireEvent.click(screen.getByRole("link", { name: "Scanner" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "2026 auswählen" })).toBeTruthy());
    fireEvent.click(screen.getByRole("checkbox", { name: "2026 auswählen" }));
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Importieren" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Alle Dateien aus diesem Ordner und Unterordnern importieren/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Ordnerstruktur übernehmen/ }));
    fireEvent.change(screen.getByLabelText("Zielordner"), { target: { value: "archiv" } });
    fireEvent.blur(screen.getByLabelText("Zielordner"));
    fireEvent.click(screen.getAllByRole("button", { name: "Importieren" }).at(-1)!);

    await waitFor(() => expect(screen.getByText("Import von 1 Datei gestartet, 1 bereits importiert")).toBeTruthy());
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({
      files: ["brief.jpg"],
      folders: ["2026"],
      recursive: true,
      allFiles: false,
      keepStructure: true,
      base: "",
      targetFolders: ["archiv"],
    });
    await waitFor(() => expect(screen.queryByText("2 ausgewählt") === null).toBe(true));
  });

  test("can list all files", async () => {
    await setup(<SourceBrowserPage />, "/sources/3");
    fireEvent.click(screen.getByRole("checkbox", { name: "Alle Dateien anzeigen" }));
    await waitFor(() => expect(fetchMock.calls.some((c) => c.path === "/api/sources/3/browse?all=true")).toBe(true));
  });
});
