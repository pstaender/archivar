import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import { type FetchMock, makeDocument, mockFetch, renderApp, selectTab, settle } from "../../../test/client";
import { DocumentPage } from "./DocumentPage";

let fetchMock: FetchMock;
afterEach(() => {
  fetchMock.restore();
  localStorage.clear();
});

async function open(overrides: Parameters<typeof makeDocument>[0] = {}, routes: Parameters<typeof mockFetch>[0] = {}) {
  const doc = makeDocument({ id: 7, ...overrides });
  fetchMock = mockFetch({
    ...routes,
    "GET /api/config": () => ({ dewarpAvailable: false, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
    "GET /api/settings": () => DEFAULT_USER_SETTINGS,
    "GET /api/folders": () => [],
    "GET /api/documents/7": () => doc,
    "POST /api/documents/7/pdf": () =>
      new Response(new Blob(["%PDF"]), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename*=UTF-8''Brief%20M%C3%A4rz.pdf" } }),
  });
  localStorage.setItem("archivar.documentTab", "details");
  const view = await renderApp(<DocumentPage />, { path: "/documents/7", route: "/documents/:id" });
  await screen.findByRole("tab", { name: "Datei" });
  return view;
}

describe("Datei tab", () => {
  test("exports the image with its stored text as a PDF download", async () => {
    await open({ kind: "image", ocrStatus: "done", ocrText: "Hallo" });
    expect(screen.getByRole("tab", { name: "Datei" }).getAttribute("aria-selected")).toBe("true");
    const createObjectURL = spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    const clicks: { href: string; download: string }[] = [];
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: "PDF" }));
      await settle();
      expect(fetchMock.calls.filter((c) => c.method === "POST")).toEqual([{ method: "POST", path: "/api/documents/7/pdf", body: {} }]);
      expect(clicks).toEqual([{ href: "blob:pdf", download: "Brief März.pdf" }]);
    } finally {
      createObjectURL.mockRestore();
      click.mockRestore();
    }
  });

  test("the arrow next to PDF downloads it in another quality", async () => {
    await open({ kind: "image", ocrStatus: "done", ocrText: "Hallo" });
    const createObjectURL = spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const posted = () => fetchMock.calls.filter((c) => c.method === "POST").map((c) => c.body);
    try {
      fireEvent.click(screen.getByRole("button", { name: "PDF-Qualität wählen" }));
      const items = screen.getAllByRole("menuitem");
      expect(items.map((item) => item.querySelector(".menu__label")?.textContent)).toEqual(["Niedrig", "MittelStandard", "Hoch", "Original", "Eigene …"]);
      fireEvent.click(screen.getByRole("menuitem", { name: /^Original/ }));
      await settle();
      expect(screen.queryByRole("menu") === null).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "PDF-Qualität wählen" }));
      fireEvent.click(screen.getByRole("menuitem", { name: /^Eigene/ }));
      fireEvent.change(screen.getByLabelText("Qualität"), { target: { value: "3" } });
      fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));
      await settle();
      expect(posted()).toEqual([{ quality: "original" }, { quality: 3 }]);
      expect(localStorage.getItem("archivar.pdfCompression")).toBe("3");
    } finally {
      createObjectURL.mockRestore();
      click.mockRestore();
    }
  });

  test("offers the PDF export only for images and not while OCR runs", async () => {
    const view = await open({ kind: "pdf", ocrStatus: "done" });
    expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
    expect(screen.getByRole("link", { name: "Original" })).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Text", "Datei"]);
    view.unmount();
    fetchMock.restore();
    await open({ kind: "image", ocrStatus: "running" });
    expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("the „Mehr“ menu opens the other tabs and closes with Escape", async () => {
    await open({ kind: "image" });
    fireEvent.click(screen.getByRole("tab", { name: "Mehr" }));
    const menu = screen.getByRole("menu");
    expect(document.activeElement?.textContent).toBe("Vektor");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Formen");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu") === null).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Mehr" }));
    fireEvent.pointerDown(screen.getByRole("tab", { name: "Text" }));
    expect(screen.queryByRole("menu") === null).toBe(true);
    selectTab("Formen");
    expect(screen.getByRole("tab", { name: "Formen" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("menu") === null).toBe(true);
  });

  test("duplicates the document and opens the copy", async () => {
    const copy = makeDocument({ id: 8, title: "Brief (Kopie)", copyOf: { id: 7, title: "Brief" } });
    const { router } = await open(
      { title: "Brief" },
      { "POST /api/documents/7/duplicate": () => copy, "GET /api/documents/8": () => copy },
    );
    fireEvent.click(screen.getByRole("button", { name: "Duplizieren" }));
    await screen.findByRole("button", { name: "Eigenständig machen" });
    expect(router.state.location.pathname).toBe("/documents/8");
    expect(screen.getByRole("link", { name: "Brief" }).getAttribute("href")).toBe("/documents/7");
  });

  test("lists the duplicates and warns that they keep the file when the original is deleted", async () => {
    await open({ title: "Brief", copies: [{ id: 8, title: "Kopie A" }, { id: 9, title: "Kopie B" }] });
    expect(screen.getByRole("link", { name: "Kopie A" }).getAttribute("href")).toBe("/documents/8");
    expect(screen.getByRole("link", { name: "Kopie B" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Eigenständig machen" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dokument löschen" }));
    expect(screen.getByText(/Die Originaldatei bleibt für die 2 Duplikate erhalten, „Kopie A“ wird zum neuen Original\./)).toBeTruthy();
  });

  test("makes a duplicate independent", async () => {
    await open(
      { copyOf: { id: 3, title: "Brief" } },
      { "POST /api/documents/7/detach": () => makeDocument({ id: 7 }) },
    );
    fireEvent.click(screen.getByRole("button", { name: "Eigenständig machen" }));
    await settle();
    expect(screen.queryByRole("button", { name: "Eigenständig machen" }) === null).toBe(true);
    expect(screen.queryByText("Duplikat von") === null).toBe(true);
    expect(fetchMock.calls.some((c) => c.method === "POST" && c.path === "/api/documents/7/detach")).toBe(true);
  });
});
