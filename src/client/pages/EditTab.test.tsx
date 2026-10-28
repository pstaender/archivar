import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import { type FetchMock, makeDocument, mockFetch, renderApp, selectTab } from "../../../test/client";
import { DocumentPage } from "./DocumentPage";

let fetchMock: FetchMock;
afterEach(() => {
  fetchMock.restore();
  localStorage.clear();
});

async function openEditor(autoCropAvailable: boolean) {
  fetchMock = mockFetch({
    "GET /api/config": () => ({ dewarpAvailable: false, autoCropAvailable, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
    "GET /api/settings": () => DEFAULT_USER_SETTINGS,
    "GET /api/folders": () => [],
    "GET /api/documents/1": () => makeDocument({ id: 1 }),
  });
  await renderApp(<DocumentPage />, { path: "/documents/1", route: "/documents/:id" });
  await screen.findByRole("tab", { name: "Text" });
  selectTab("Bearbeiten");
}

describe("Bearbeiten tab", () => {
  test("offers Auto-Zuschnitt when the segmentation model is installed", async () => {
    await openEditor(true);
    expect(await screen.findByRole("button", { name: /Auto-Zuschnitt/ })).toBeTruthy();
  });

  test("hides Auto-Zuschnitt without the segmentation model", async () => {
    await openEditor(false);
    await screen.findByRole("button", { name: /Auto-Drehen/ });
    expect(screen.queryByRole("button", { name: /Auto-Zuschnitt/ }) === null).toBe(true);
  });

  test("copies the image settings and pastes them into another image without saving", async () => {
    const pasted = { ...DEFAULT_EDIT_SETTINGS, colorMode: "bw" as const, bwThreshold: 140, contrast: 0.3 };
    fetchMock = mockFetch({
      "GET /api/config": () => ({ dewarpAvailable: false, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
      "GET /api/settings": () => DEFAULT_USER_SETTINGS,
      "GET /api/folders": () => [],
      "GET /api/documents/1": () => makeDocument({ id: 1, editSettings: { ...DEFAULT_EDIT_SETTINGS, colorMode: "bw", bwThreshold: 140, contrast: 0.3 } }),
      "GET /api/documents/2": () => makeDocument({ id: 2, editSettings: { ...DEFAULT_EDIT_SETTINGS, brightness: 0.5 } }),
      "POST /api/documents/2/apply-preset": () => ({ editSettings: pasted, shapes: null }),
    });
    const { router } = await renderApp(<DocumentPage />, { path: "/documents/1", route: "/documents/:id" });
    await screen.findByRole("tab", { name: "Text" });
    selectTab("Bearbeiten");
    expect((screen.getByRole("button", { name: "Bildeinstellungen einfügen" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Bildeinstellungen kopieren" }));

    await router.navigate("/documents/2");
    await waitFor(() => expect(fetchMock.calls.some((c) => c.path === "/api/documents/2")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Bildeinstellungen einfügen" }));
    await screen.findByText("Bildeinstellungen eingefügt – noch nicht gespeichert");
    expect(fetchMock.calls.find((c) => c.path === "/api/documents/2/apply-preset")?.body).toEqual({
      steps: { colorMode: "bw", contrast: 0.3, bwThreshold: 140 },
      editSettings: DEFAULT_EDIT_SETTINGS,
    });
    expect(fetchMock.calls.some((c) => c.method === "PATCH")).toBe(false);
    expect((screen.getByRole("slider", { name: /Schwelle/ }) as HTMLInputElement).value).toBe("140");
  });
});
