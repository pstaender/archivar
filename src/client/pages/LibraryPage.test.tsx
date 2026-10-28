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
  sessionStorage.clear();
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

  test("remembers its location and scrolls to the card named in the hash, also inside a smart stack", async () => {
    const scrolled: string[] = [];
    const scrollIntoView = spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this.getAttribute("data-item-key") ?? "");
    });
    const scans = [1, 2].map((n) => makeDocument({ id: 40 + n, title: `Scan ${n}`, createdAt: `2026-10-01T10:0${n}:00.000Z` }));
    const stack = makeStack({ id: 7, title: "Steuer" });
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [stackItem(stack), ...scans.map(docItem)] });
    try {
      const view = await renderApp(<LibraryPage />, { path: "/folders/wichtig?q=x#stack-7" });
      await waitFor(() => expect(scrolled).toEqual(["s7"]));
      expect(sessionStorage.getItem("archivar.libraryLocation")).toBe("/folders/wichtig?q=x");
      expect(document.activeElement?.getAttribute("href")).toBe("/stacks/7");
      view.unmount();

      localStorage.setItem("archivar.smartStacks", "true");
      await renderApp(<LibraryPage />, { path: "/#42" });
      await waitFor(() => expect(scrolled).toEqual(["s7", "m41-42"]));
    } finally {
      scrollIntoView.mockRestore();
    }
  });

  test("shows the cards in portrait, landscape or square and keeps the choice for all folders", async () => {
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [docItem(makeDocument())] });
    const view = await renderApp(<LibraryPage />);
    const shape = () => view.container.querySelector(".library")?.getAttribute("data-card-shape");
    expect(shape()).toBe("portrait");
    expect(screen.getByRole("radio", { name: "Hochformat" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Querformat" }));
    expect(shape()).toBe("landscape");
    expect(localStorage.getItem("archivar.cardShape")).toBe("landscape");
    view.unmount();

    const folder = await renderApp(<LibraryPage />, { path: "/folders/wichtig" });
    expect(folder.container.querySelector(".library")?.getAttribute("data-card-shape")).toBe("landscape");
    fireEvent.click(screen.getByRole("radio", { name: "Quadratisch" }));
    expect(folder.container.querySelector(".library")?.getAttribute("data-card-shape")).toBe("square");
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

  test("smart stacks group series in the view, open on their own and can become real stacks", async () => {
    const scans = [1, 2, 3].map((n) => makeDocument({ id: 20 + n, title: `Scan ${n}`, createdAt: `2026-10-01T10:0${n}:00.000Z` }));
    const other = makeDocument({ id: 30, title: "Rechnung", createdAt: "2026-09-01T10:00:00.000Z" });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(scans[2]!), docItem(other), docItem(scans[0]!), docItem(scans[1]!)],
      "POST /api/stacks": () => ({ ...makeStack({ id: 99, title: "Scan 3" }), documents: [] }),
    });
    const { router } = await renderApp(<LibraryPage />, { route: "/" });
    expect(screen.getByText("4 Einträge")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Smarte Stapel" }));
    expect(screen.getByText("2 Einträge")).toBeTruthy();
    expect(localStorage.getItem("archivar.smartStacks")).toBe("true");
    const card = screen.getByRole("link", { name: /Scan …/ });
    expect(card.getAttribute("href")).toBe("/?smart=21-22-23");
    expect(card.textContent).toContain("Namensfolge · Smarter Stapel");

    fireEvent.click(screen.getByLabelText("Scan … auswählen"));
    expect(screen.getByText("3 ausgewählt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Stapeln/ }));
    await waitFor(() => expect(fetchMock.calls.some((c) => c.method === "POST")).toBe(true));
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ documentIds: [21, 22, 23] });

    await act(() => router.navigate("/?smart=21-22-23"));
    expect(screen.getByRole("heading", { name: "Scan …" })).toBeTruthy();
    expect(screen.getByText(/Smarter Stapel · 3 Dokumente/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /^Scan \d/ }).map((link) => link.getAttribute("href"))).toEqual(["/documents/21", "/documents/22", "/documents/23"]);
    expect(screen.getByRole("link", { name: "Zurück zu „Alle Dokumente“" }).getAttribute("href")).toBe("/");
  });

  test("the overview hides what is filed in folders until the folder button shows everything", async () => {
    const loose = makeDocument({ title: "Lose" });
    const filed = makeDocument({ title: "Abgelegt", folders: ["wichtig"] });
    const stack = makeStack({ title: "Steuer", folders: ["steuer"] });
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [docItem(filed), stackItem(stack), docItem(loose)] });
    const view = await renderApp(<LibraryPage />);
    expect(screen.getByText("1 Eintrag · 2 in Ordnern ausgeblendet")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Lose/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Abgelegt/ }) === null).toBe(true);

    const toggle = screen.getByRole("button", { name: "Dokumente in Ordnern zeigen" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("3 Einträge")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Abgelegt/ })).toBeTruthy();
    expect(localStorage.getItem("archivar.showFiled")).toBe("true");
    view.unmount();

    await renderApp(<LibraryPage />, { path: "/folders/wichtig" });
    expect(screen.queryByRole("button", { name: "Dokumente in Ordnern zeigen" }) === null).toBe(true);
  });

  test("searches and folders are not filtered, and an overview with everything filed says so", async () => {
    const filed = makeDocument({ title: "Abgelegt", folders: ["wichtig"] });
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [docItem(filed)] });
    const view = await renderApp(<LibraryPage />);
    expect(screen.getByText("Alle Dokumente sind in Ordnern einsortiert.")).toBeTruthy();
    view.unmount();

    await renderApp(<LibraryPage />, { path: "/?q=abgelegt" });
    expect(screen.getByRole("link", { name: /Abgelegt/ })).toBeTruthy();
  });

  test("smart stacks are off in the custom order", async () => {
    localStorage.setItem("archivar.smartStacks", "true");
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => [] });
    await renderApp(<LibraryPage />, { path: "/folders/wichtig" });
    expect((screen.getByRole("button", { name: "Smarte Stapel" }) as HTMLButtonElement).disabled).toBe(true);
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

  test("marks all items once one is selected", async () => {
    const items = [docItem(makeDocument({ title: "Eins" })), docItem(makeDocument({ title: "Zwei" })), stackItem(makeStack({ title: "Drei" }))];
    fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/library": () => items });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Eins auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Alle markieren/ }));
    expect(screen.getByText("3 ausgewählt")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Alle markieren/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("batch processing starts a background job for all selected documents, stacks included", async () => {
    const photo = makeDocument({ title: "Foto" });
    const stack = makeStack({ id: 8, title: "Mappe", documentIds: [50, 51] });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(photo), stackItem(stack)],
      "GET /api/presets": () => [{ id: 7, name: "OCR Optimiert", steps: { autoBw: true }, createdAt: "" }],
      "POST /api/jobs": () => ({ id: 1, kind: "batch", options: null, createdAt: "", active: true, items: [] }),
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Foto auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Alle markieren/ }));
    fireEvent.click(screen.getByRole("button", { name: /Stapelverarbeitung/ }));
    fireEvent.change(screen.getByLabelText("Bildeinstellung"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Sprache"), { target: { value: "fra" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Alle Textteile erkennen/ }));
    fireEvent.change(screen.getByLabelText("Umbenennen"), { target: { value: " bw scans {n}/{m} " } });
    expect(screen.getByText("Wird zu „bw scans 1/3“ … „bw scans 3/3“.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Anwenden" }));

    await waitFor(() => expect(screen.getByText("Stapelverarbeitung für 3 Dokumente gestartet")).toBeTruthy());
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({
      kind: "batch",
      documentIds: [photo.id, 50, 51],
      presetId: 7,
      ocr: true,
      languages: ["fra"],
      allText: true,
      rename: "bw scans {n}/{m}",
    });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  test("batch processing recognizes text with the default languages and needs something to do", async () => {
    const photo = makeDocument({ title: "Foto" });
    fetchMock = mockFetch({
      "GET /api/folders": () => [],
      "GET /api/library": () => [docItem(photo)],
      "POST /api/jobs": () => ({ id: 1, kind: "batch", options: null, createdAt: "", active: true, items: [] }),
    });
    await renderApp(<LibraryPage />);
    fireEvent.click(screen.getByLabelText("Foto auswählen"));
    fireEvent.click(screen.getByRole("button", { name: /Stapelverarbeitung/ }));

    const apply = screen.getByRole("button", { name: "Anwenden" }) as HTMLButtonElement;
    fireEvent.click(screen.getByRole("checkbox", { name: /Text erkennen/ }));
    expect(apply.disabled).toBe(true);
    expect((screen.getByLabelText("Sprache") as HTMLSelectElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Umbenennen"), { target: { value: "Scan" } });
    expect(apply.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Umbenennen"), { target: { value: "  " } });
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Text erkennen/ }));
    fireEvent.click(apply);

    await waitFor(() => expect(screen.getByText("Stapelverarbeitung für 1 Dokument gestartet")).toBeTruthy());
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toMatchObject({ presetId: null, ocr: true, languages: null, allText: false, rename: null });
  });

  const folders = () => [folder(1, "privat"), folder(2, "wichtig"), folder(3, "wichtig/2026")];
  const patches = () => fetchMock.calls.filter((c) => c.method === "PATCH").map((c) => [c.path, c.body]);

  test("adds the selection to existing folders, keeping its other folders", async () => {
    localStorage.setItem("archivar.showFiled", "true");
    const a = makeDocument({ title: "Brief", folders: ["privat"] });
    fetchMock = mockFetch({
      "GET /api/folders": folders,
      "GET /api/library": () => [docItem(a)],
      [`PATCH /api/documents/${a.id}`]: () => a,
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByRole("button", { name: "Ordner" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Ordner" }));
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
    localStorage.setItem("archivar.showFiled", "true");
    const a = makeDocument({ title: "Brief", folders: ["privat", "wichtig"] });
    fetchMock = mockFetch({
      "GET /api/folders": folders,
      "GET /api/library": () => [docItem(a)],
      [`PATCH /api/documents/${a.id}`]: () => a,
    });
    await renderApp(<LibraryPage />);

    fireEvent.click(screen.getByLabelText("Brief auswählen"));
    fireEvent.click(screen.getByRole("button", { name: "Ordner" }));
    const verschieben = screen.getByRole("button", { name: "Verschieben" }) as HTMLButtonElement;
    expect(verschieben.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Ordner suchen oder anlegen"), { target: { value: " steuer / 2026 " } });
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
    localStorage.setItem("archivar.showFiled", "true");
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
      fireEvent.click(screen.getByRole("button", { name: "PDF" }));
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
    expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Notiz abwählen"));
    fireEvent.click(screen.getByLabelText("Urlaub auswählen"));
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
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
      await act(async () => xhr.uploads[0]!.respond(201, [{ ...eins, duplicates: [] }]));
      await waitFor(() => expect(screen.getByRole("link", { name: /eins/ })).toBeTruthy());
      expect(xhr.uploads).toHaveLength(2);
      expect(screen.getByText("2 Einträge")).toBeTruthy();

      const zwei = makeDocument({ title: "zwei" });
      listed.unshift(docItem(zwei));
      await act(async () => xhr.uploads[1]!.respond(201, [{ ...zwei, duplicates: [] }]));
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
