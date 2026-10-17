import { afterEach, describe, expect, test } from "bun:test";
import { screen } from "@testing-library/react";
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
});
