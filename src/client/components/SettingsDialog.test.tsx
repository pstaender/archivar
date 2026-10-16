import { afterEach, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { SettingsDialog } from "./SettingsDialog";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

test("loads the settings, marks the defaults and saves the changes", async () => {
  fetchMock = mockFetch({
    "GET /api/folders": () => [],
    "GET /api/settings": () => ({ uploadEnhancement: "bw", pdfImageQuality: "original" }),
    "PATCH /api/settings": (_url, init) => JSON.parse(String(init.body)),
  });
  const onClose = mock();
  await renderApp(<SettingsDialog open onClose={onClose} />);

  expect((screen.getByRole("radio", { name: /^Schwarzweiß/ }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("radio", { name: /^Original.*voller Auflösung/ }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getAllByText("Standard")).toHaveLength(2);

  fireEvent.click(screen.getByRole("radio", { name: /^Graustufen/ }));
  fireEvent.click(screen.getByRole("radio", { name: /^150 DPI/ }));
  fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({ uploadEnhancement: "grayscale", pdfImageQuality: "150" });
  expect(screen.getByText("Einstellungen gespeichert")).toBeTruthy();
});

test("closes without saving on Abbrechen", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/settings": () => ({ uploadEnhancement: "bw", pdfImageQuality: "300" }) });
  const onClose = mock();
  await renderApp(<SettingsDialog open onClose={onClose} />);
  fireEvent.click(screen.getByRole("radio", { name: /^Farbe/ }));
  fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(onClose).toHaveBeenCalled();
  expect(fetchMock.calls.some((c) => c.method === "PATCH")).toBe(false);
});
