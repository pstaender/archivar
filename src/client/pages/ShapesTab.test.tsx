import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import type { Shape } from "../../shared/shapes";
import { type FetchMock, makeDocument, mockFetch, renderApp } from "../../../test/client";
import { DocumentPage } from "./DocumentPage";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const shape: Shape = { id: "a", type: "rect", x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: "#000000" };

async function open(overrides: Parameters<typeof makeDocument>[0] = {}) {
  let doc = makeDocument({ id: 1, ocrStatus: "done", ocrText: "Geheim", ...overrides });
  fetchMock = mockFetch({
    "GET /api/config": () => ({ dewarpAvailable: false, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
    "GET /api/settings": () => DEFAULT_USER_SETTINGS,
    "GET /api/folders": () => [],
    "GET /api/documents/1": () => doc,
    "PATCH /api/documents/1": (_url, init) => {
      const { shapes } = JSON.parse(String(init.body)) as { shapes: Shape[] };
      doc = { ...doc, shapes, ocrStatus: "pending", updatedAt: "2026-03-02T10:00:00.000Z" };
      return doc;
    },
  });
  const view = await renderApp(<DocumentPage />, { path: "/documents/1", route: "/documents/:id" });
  await screen.findByRole("tab", { name: "Formen" });
  return view;
}

describe("Formen tab", () => {
  test("sits between Text and Details and shows the image without its shapes", async () => {
    const view = await open({ shapes: [shape], shapesOutdated: true });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bearbeiten", "Text", "Formen", "Details"]);
    fireEvent.click(screen.getByRole("tab", { name: "Formen" }));
    expect(view.container.querySelector(".editor-canvas__image")?.getAttribute("src")).toStartWith("/api/documents/1/edited?");
    expect(screen.getByRole("button", { name: "Rechteck 1" })).toBeTruthy();
    expect(screen.getByText(/Prüfe, ob die Formen noch an der richtigen Stelle liegen/)).toBeTruthy();
    expect(screen.getByText(/Nach dem Speichern wird der Text neu erkannt/)).toBeTruthy();
  });

  test("saves changed shapes and reports that the text is recognized again", async () => {
    await open({ shapes: [shape] });
    fireEvent.click(screen.getByRole("tab", { name: "Formen" }));
    const save = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Alle entfernen" }));
    fireEvent.click(save);
    await screen.findByText("Formen gespeichert – Text wird neu erkannt");
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({ shapes: [] });
    expect(save.disabled).toBe(true);
  });

  test("asks before leaving the tab with unsaved shapes", async () => {
    await open({ shapes: [shape] });
    fireEvent.click(screen.getByRole("tab", { name: "Formen" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Rechteck 1" }), { key: "Delete" });
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    const dialog = (await screen.findByText("Bearbeitung nicht gespeichert")).closest("dialog") as HTMLElement;
    expect(screen.getByRole("tab", { name: "Formen" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Verwerfen", hidden: true }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(screen.getByRole("tab", { name: "Formen" }));
    expect(screen.getByRole("button", { name: "Rechteck 1" })).toBeTruthy();
  });
});
