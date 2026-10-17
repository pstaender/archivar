import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Job } from "../../shared/jobs";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { FolderTree } from "../components/FolderTree";
import { JobsPage } from "./JobsPage";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const doc = (id: number, title: string) => ({ id, title, originalName: `${title}.jpg`, kind: "image" as const, updatedAt: "2026-10-17T10:00:00.000Z" });

const batch: Job = {
  id: 2,
  kind: "batch",
  options: { preset: { name: "OCR Optimiert", steps: { autoBw: true } }, ocr: true, languages: ["fra"], allText: true },
  createdAt: "2026-10-17T10:00:00.000Z",
  active: true,
  items: [
    { id: 1, name: "Rechnung", state: "done", error: null, note: null, document: doc(10, "Rechnung") },
    { id: 2, name: "Brief", state: "ocr", error: null, note: null, document: doc(11, "Brief") },
    { id: 3, name: "Foto", state: "running", error: null, note: null, document: doc(12, "Foto") },
    { id: 4, name: "Notiz", state: "pending", error: null, note: null, document: doc(13, "Notiz") },
    { id: 5, name: "Weg", state: "failed", error: "Das Dokument wurde gelöscht.", note: null, document: null },
  ],
};

const upload: Job = {
  id: 1,
  kind: "import",
  options: null,
  createdAt: "2026-10-16T09:00:00.000Z",
  active: false,
  items: [{ id: 6, name: "scan.jpg", state: "done", error: null, note: "Bereits vorhanden als „Rechnung“", document: doc(14, "scan") }],
};

describe("JobsPage", () => {
  test("lists jobs with the state of each document", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/jobs": () => [batch, upload] });
    await renderApp(<JobsPage />);

    const running = screen.getByRole("region", { name: /^Stapelverarbeitung vom/ });
    expect(running.textContent).toContain("Bildeinstellung „OCR Optimiert“ · Texterkennung (Französisch, alle Textteile)");
    expect(running.textContent).toContain("2 von 5 fertig · 1 fehlgeschlagen");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent).slice(0, 5)).toEqual([
      "RechnungFertig",
      "BriefText wird erkannt",
      "FotoWird bearbeitet",
      "NotizWartet",
      "WegFehlerDas Dokument wurde gelöscht.",
    ]);
    expect(screen.getByRole("link", { name: "Rechnung" }).getAttribute("href")).toBe("/documents/10");
    expect(screen.queryByRole("button", { name: "Auftrag entfernen" })).toBeTruthy();
    const imported = screen.getByRole("region", { name: /^Import vom/ });
    expect(imported.textContent).toContain("1 Datei");
    expect(imported.textContent).toContain("Bereits vorhanden als „Rechnung“");
    expect(imported.querySelector("time")?.getAttribute("dateTime")).toBe(upload.createdAt);
  });

  test("removes finished jobs", async () => {
    let jobs = [batch, upload];
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/jobs": () => jobs,
      "DELETE /api/jobs/1": () => {
        jobs = [batch];
        return undefined;
      },
    });
    await renderApp(<JobsPage />);
    fireEvent.click(screen.getByRole("button", { name: /Erledigte entfernen/ }));
    // A boolean, as Bun takes very long to print a DOM element when the assertion is retried.
    await waitFor(() => expect(screen.queryByRole("region", { name: /^Import vom/ }) === null).toBe(true));
    expect(fetchMock.calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual(["/api/jobs/1"]);
  });

  test("the sidebar entry counts the running jobs", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/jobs": () => [batch, upload] });
    await renderApp(<FolderTree />);
    expect(screen.getByRole("link", { name: /Stapelverarbeitung/ }).textContent).toBe("Stapelverarbeitung1");
  });
});
