import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { docItem, folder, makeDocument, makeStack, mockFetch, mockXhr, renderApp, stackItem, type FetchMock } from "../../../test/client";
import type { LibraryItem } from "../../shared/types";
import { UploadButtons } from "../components/UploadButtons";
import { LibraryPage } from "./LibraryPage";

let fetchMock: FetchMock;
afterEach(() => {
  fetchMock.restore();
  localStorage.clear();
});

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
    expect(fetchMock.calls.some((c) => c.path === "/api/library?folder=wichtig%2F2026&q=miete&sort=custom")).toBe(true);
    expect(screen.getByRole("heading", { name: "Suche „miete“" })).toBeTruthy();
    expect(screen.getByText("Keine passenden Dokumente gefunden.")).toBeTruthy();
  });

  test("redirects old folder query links to folder routes", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />, { path: "/?folder=wichtig%2F2026" });
    expect(fetchMock.calls.some((c) => c.path === "/api/library?folder=wichtig%2F2026&sort=custom")).toBe(true);
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

  const folders = () => [folder(1, "privat"), folder(2, "wichtig"), folder(3, "wichtig/2026")];
  const patches = () => fetchMock.calls.filter((c) => c.method === "PATCH").map((c) => [c.path, c.body]);

  test("adds the selection to existing folders, keeping its other folders", async () => {
    const a = makeDocument({ title: "Brief", folders: ["privat"] });
    fetchMock = mockFetch({
      "GET /api/folders": folders,
      "GET /api/library": () => [docItem(a)],
      [`PATCH /api/documents/${a.id}`]: () => a,
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Ordner/ }));
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["privat", "wichtig", "wichtig/2026"]);
    fireEvent.click(screen.getByLabelText("wichtig/2026"));
    fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));

    await waitFor(() => expect(patches()).toEqual([[`/api/documents/${a.id}`, { folders: ["privat", "wichtig/2026"] }]]));
    await waitFor(() => expect(screen.getByText("Zu „wichtig/2026“ hinzugefügt")).toBeTruthy());
  });

  test("moves the selection out of the current folder into another one", async () => {
    const a = makeDocument({ title: "Brief", folders: ["privat/alt", "steuer"] });
    const stack = makeStack({ title: "Mappe", folders: ["privat"], documentIds: [70] });
    fetchMock = mockFetch({
      "GET /api/folders": folders,
      "GET /api/library": () => [docItem(a), stackItem(stack)],
      [`PATCH /api/documents/${a.id}`]: () => a,
      [`PATCH /api/stacks/${stack.id}`]: () => stack,
    });
    await renderApp(<LibraryPage />, { path: "/folders/privat" });

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByLabelText("Mappe auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Ordner/ }));
    expect(screen.getByText(/nimmt die Auswahl aus „privat“ heraus/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("wichtig"));
    fireEvent.click(screen.getByRole("button", { name: "Verschieben" }));

    await waitFor(() =>
      expect(patches()).toEqual([
        [`/api/documents/${a.id}`, { folders: ["steuer", "wichtig"] }],
        [`/api/stacks/${stack.id}`, { folders: ["wichtig"] }],
      ]),
    );
  });

  test("creates a new folder in the dialog and moves the selection there from the overview", async () => {
    const a = makeDocument({ title: "Brief", folders: ["privat", "wichtig"] });
    fetchMock = mockFetch({
      "GET /api/folders": folders,
      "GET /api/library": () => [docItem(a)],
      [`PATCH /api/documents/${a.id}`]: () => a,
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Ordner/ }));
    const verschieben = screen.getByRole("button", { name: "Verschieben" }) as HTMLButtonElement;
    expect(verschieben.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Neuer Ordner"), { target: { value: " steuer / 2026 " } });
    fireEvent.click(screen.getByRole("button", { name: /Anlegen/ }));
    expect((screen.getByLabelText("steuer/2026") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("neu")).toBeTruthy();
    fireEvent.click(verschieben);

    await waitFor(() => expect(patches()).toEqual([[`/api/documents/${a.id}`, { folders: ["steuer/2026"] }]]));
  });

  test("removes the selection from the folder being viewed, including its sub-folders", async () => {
    const a = makeDocument({ title: "Brief", folders: ["privat", "wichtig/2026"] });
    const stack = makeStack({ title: "Mappe", folders: ["wichtig"], documentIds: [70] });
    fetchMock = mockFetch({
      "GET /api/folders": folders,
      "GET /api/library": () => [docItem(a), stackItem(stack)],
      [`PATCH /api/documents/${a.id}`]: () => a,
      [`PATCH /api/stacks/${stack.id}`]: () => stack,
    });
    await renderApp(<LibraryPage />, { path: "/folders/wichtig" });

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByLabelText("Mappe auswählen"));
    fireEvent.click(screen.getByRole("button", { name: "Aus „wichtig“ entfernen" }));

    await waitFor(() =>
      expect(patches()).toEqual([
        [`/api/documents/${a.id}`, { folders: ["privat"] }],
        [`/api/stacks/${stack.id}`, { folders: [] }],
      ]),
    );
    await waitFor(() => expect(screen.getByText("Aus „wichtig“ entfernt")).toBeTruthy());
  });

  test("offers removing from a folder only inside a folder", async () => {
    const a = makeDocument({ title: "Brief", folders: ["privat"] });
    fetchMock = mockFetch({ "GET /api/folders": folders, "GET /api/library": () => [docItem(a)] });
    await renderApp(<LibraryPage />);
    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    expect(screen.queryByRole("button", { name: /entfernen/ })).toBeNull();
  });

  test("downloads the selected documents and stacks as one PDF", async () => {
    const a = makeDocument({ title: "Seite A" });
    const stack = makeStack({ title: "Alt", documentIds: [50, 51] });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(a), stackItem(stack)],
      "POST /api/export/pdf": () =>
        new Response(new Blob(["%PDF"]), { headers: { "Content-Disposition": "attachment; filename*=UTF-8''Dokumente.pdf" } }),
    });
    const createObjectURL = spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    const downloads: string[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    try {
      await renderApp(<LibraryPage />);
      fireEvent.click(screen.getByLabelText("Seite A auswählen"));
      fireEvent.click(screen.getByLabelText("Alt auswählen"));
      fireEvent.click(screen.getByRole("button", { name: /PDF/ }));
      await waitFor(() => expect(downloads).toEqual(["Dokumente.pdf"]));
      expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ documentIds: [a.id, 50, 51] });
    } finally {
      createObjectURL.mockRestore();
      click.mockRestore();
    }
  });

  test("names the PDF after a single selected item and is disabled for other files only", async () => {
    const photo = makeDocument({ title: "Urlaub" });
    const other = makeDocument({ title: "Notiz", kind: "file" });
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [docItem(photo), docItem(other)] });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Notiz auswählen"));
    expect((screen.getByRole("button", { name: /PDF/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Notiz abwählen"));
    fireEvent.click(screen.getByLabelText("Urlaub auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /PDF/ }));
    await waitFor(() => expect(fetchMock.calls.some((c) => c.method === "POST")).toBe(true));
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ documentIds: [photo.id], title: "Urlaub" });
  });

  test("shows each uploaded file right away without reloading the page visibly", async () => {
    const listed: LibraryItem[] = [docItem(makeDocument({ title: "Alt" }))];
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [...listed] });
    const xhr = mockXhr();
    try {
      await renderApp(
        <>
          <UploadButtons />
          <LibraryPage />
        </>,
      );
      const grid = document.querySelector(".grid")!;
      const busyStates: string[] = [];
      new MutationObserver(() => busyStates.push(grid.getAttribute("aria-busy")!)).observe(grid, { attributeFilter: ["aria-busy"] });

      await act(async () => {
        fireEvent.change(screen.getByTestId("file-input"), {
          target: { files: [new File(["1"], "eins.jpg", { type: "image/jpeg" }), new File(["2"], "zwei.jpg", { type: "image/jpeg" })] },
        });
      });
      const eins = makeDocument({ title: "eins" });
      listed.unshift(docItem(eins));
      await act(async () => xhr.uploads[0]!.respond(201, [eins]));
      await waitFor(() => expect(screen.getByRole("link", { name: /eins/ })).toBeTruthy());
      expect(xhr.uploads).toHaveLength(2);
      expect(screen.getByText("2 Einträge")).toBeTruthy();

      const zwei = makeDocument({ title: "zwei" });
      listed.unshift(docItem(zwei));
      await act(async () => xhr.uploads[1]!.respond(201, [zwei]));
      await waitFor(() => expect(screen.getByText("3 Einträge")).toBeTruthy());
      expect(busyStates).not.toContain("true");
    } finally {
      xhr.restore();
    }
  });

  test("sorts by the chosen criterion and remembers it", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [docItem(makeDocument({ title: "Brief" }))] });
    await renderApp(<LibraryPage />);
    const select = screen.getByLabelText("Sortierung") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "Zuletzt geändert",
      "Hochgeladen, neueste zuerst",
      "Hochgeladen, älteste zuerst",
      "Name A–Z",
      "Name Z–A",
    ]);
    fireEvent.change(select, { target: { value: "title-asc" } });
    await waitFor(() => expect(fetchMock.calls.some((c) => c.path === "/api/library?sort=title-asc")).toBe(true));
    expect(localStorage.getItem("archivar.librarySort")).toBe("title-asc");
  });

  test("opens folders in their own order first and keeps the overview's choice separate", async () => {
    localStorage.setItem("archivar.librarySort", "title-asc");
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />, { path: "/folders/obst" });
    const select = screen.getByLabelText("Sortierung") as HTMLSelectElement;
    expect(select.value).toBe("custom");
    expect(select.options[0]?.textContent).toBe("Eigene Reihenfolge");
    expect(fetchMock.calls.some((c) => c.path === "/api/library?folder=obst&sort=custom")).toBe(true);
    fireEvent.change(select, { target: { value: "created-desc" } });
    await waitFor(() => expect(fetchMock.calls.some((c) => c.path === "/api/library?folder=obst&sort=created-desc")).toBe(true));
    expect(localStorage.getItem("archivar.folderSort")).toBe("created-desc");
    expect(localStorage.getItem("archivar.librarySort")).toBe("title-asc");
    fetchMock.restore();

    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />);
    expect(fetchMock.calls.some((c) => c.path === "/api/library?sort=title-asc")).toBe(true);
  });

  test("moves a card with the keyboard grip and stores the folder's order", async () => {
    const a = makeDocument({ title: "Erstes" });
    const b = makeDocument({ title: "Zweites" });
    const stack = makeStack({ title: "Mappe", documentIds: [90] });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(a), docItem(b), stackItem(stack)],
      "PUT /api/folders/order": () => undefined,
    });
    await renderApp(<LibraryPage />, { path: "/folders/obst" });
    expect(screen.getByText(/Karten ziehen, um sie anzuordnen/)).toBeTruthy();

    const grip = screen.getByRole("button", { name: "Mappe verschieben" });
    grip.focus();
    await act(async () => {
      fireEvent.keyDown(grip, { code: "Space", key: " " });
    });
    await act(async () => {
      fireEvent.keyDown(grip, { code: "ArrowLeft", key: "ArrowLeft" });
    });
    await act(async () => {
      fireEvent.keyDown(grip, { code: "Space", key: " " });
    });

    await waitFor(() => expect(fetchMock.calls.some((c) => c.method === "PUT")).toBe(true));
    const put = fetchMock.calls.find((c) => c.method === "PUT")!;
    expect(put.body).toMatchObject({ folder: "obst" });
    expect((put.body as { items: unknown[] }).items).toHaveLength(3);
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
