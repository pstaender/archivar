import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { docItem, makeDocument, makeStack, mockFetch, renderApp, stackItem, type FetchMock } from "../../../test/client";
import { LibraryPage } from "./LibraryPage";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

describe("LibraryPage", () => {
  test("lists documents and stacks", async () => {
    const doc = makeDocument({ title: "Rechnung" });
    const stack = makeStack({ title: "Steuer 2026", documentIds: [10, 11], coverDocumentId: 10 });
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [stackItem(stack), docItem(doc)] });
    await renderApp(<LibraryPage />);

    expect(screen.getByRole("heading", { name: "Alle Dokumente" })).toBeTruthy();
    expect(screen.getByText("2 Einträge")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Rechnung/ }).getAttribute("href")).toBe(`/documents/${doc.id}`);
    expect(screen.getByRole("link", { name: /Steuer 2026/ }).getAttribute("href")).toBe(`/stacks/${stack.id}`);
  });

  test("passes folder and search filters to the API", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />, { path: "/folders/wichtig/2026?q=miete" });
    expect(fetchMock.calls.some((c) => c.path === "/api/library?folder=wichtig%2F2026&q=miete")).toBe(true);
    expect(screen.getByRole("heading", { name: "Suche „miete“" })).toBeTruthy();
    expect(screen.getByText("Keine passenden Dokumente gefunden.")).toBeTruthy();
  });

  test("redirects old folder query links to folder routes", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />, { path: "/?folder=wichtig%2F2026" });
    expect(fetchMock.calls.some((c) => c.path === "/api/library?folder=wichtig%2F2026")).toBe(true);
    expect(screen.getByRole("heading", { name: "wichtig / 2026" })).toBeTruthy();
  });

  test("shows an upload prompt for an empty archive", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />);
    expect(screen.getByText("Noch nichts archiviert")).toBeTruthy();
  });

  test("selecting items and stacking them creates a stack from all contained documents", async () => {
    const a = makeDocument({ title: "Seite A" });
    const stack = makeStack({ title: "Alt", documentIds: [50, 51] });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(a), stackItem(stack)],
      "POST /api/stacks": () => ({ ...makeStack({ id: 99, title: "Seite A" }), documents: [] }),
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Seite A auswählen"));
    fireEvent.click(screen.getByLabelText("Alt auswählen"));
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Stapeln/ }));
    await waitFor(() => expect(fetchMock.calls.some((c) => c.method === "POST")).toBe(true));
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ documentIds: [a.id, 50, 51] });
  });

  test("clicking a card in selection mode toggles instead of navigating", async () => {
    const a = makeDocument({ title: "Eins" });
    const b = makeDocument({ title: "Zwei" });
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [docItem(a), docItem(b)] });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Eins auswählen"));
    fireEvent.click(screen.getByRole("link", { name: /Zwei/ }));
    expect(screen.getByText("2 ausgewählt")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Auswahl aufheben"));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  test("assigns folders to the selection, keeping existing ones", async () => {
    const a = makeDocument({ title: "Brief", folders: ["privat"] });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(a)],
      [`PATCH /api/documents/${a.id}`]: () => a,
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Ordner/ }));
    const input = screen.getByLabelText("Ordner hinzufügen");
    fireEvent.change(input, { target: { value: "wichtig/2026" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Zuweisen" }));

    await waitFor(() => expect(fetchMock.calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({ folders: ["privat", "wichtig/2026"] });
  });

  test("shows API errors", async () => {
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => Response.json({ error: "Datenbank weg" }, { status: 500 }),
    });
    await renderApp(<LibraryPage />);
    expect(screen.getByText("Datenbank weg")).toBeTruthy();
  });
});
