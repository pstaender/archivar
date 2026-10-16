import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { SettingsDialog } from "./SettingsDialog";

let fetchMock: FetchMock;
afterEach(() => {
  fetchMock.restore();
  localStorage.clear();
});

function mockSettings(stored = {}) {
  return mockFetch({
    "GET /api/folders": () => [],
    "GET /api/config": () => ({ dewarpAvailable: true, convertibleImageTypes: [] }),
    "GET /api/settings": () => ({ ...DEFAULT_USER_SETTINGS, ...stored }),
    "PATCH /api/settings": (_url, init) => ({ ...DEFAULT_USER_SETTINGS, ...stored, ...JSON.parse(String(init.body)) }),
  });
}

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const checkbox = (name: RegExp) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("SettingsDialog", () => {
  test("shows image sizes, image editing and OCR on separate tabs and saves all of them", async () => {
    fetchMock = mockSettings({ pdfImageQuality: "original" });
    const onClose = mock();
    await renderApp(<SettingsDialog open onClose={onClose} />);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bildgrößen", "Bildbearbeitung", "OCR"]);
    expect(radio(/^Original.*voller Auflösung/).checked).toBe(true);
    expect(screen.getByText("Standard")).toBeTruthy();
    fireEvent.click(radio(/^150 DPI/));

    tab("Bildbearbeitung");
    expect(radio(/^Schwarzweiß/).checked).toBe(true);
    fireEvent.click(radio(/^Graustufen/));
    fireEvent.click(checkbox(/Automatisch entzerren/));

    tab("OCR");
    expect(checkbox(/Nach dem Upload erkennen/).checked).toBe(true);
    fireEvent.click(checkbox(/Alle Textteile erkennen/));

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      ...DEFAULT_USER_SETTINGS,
      pdfImageQuality: "150",
      uploadEnhancement: "grayscale",
      autoDewarp: true,
      ocrAllText: true,
    });
    expect(screen.getByText("Einstellungen gespeichert")).toBeTruthy();
  });

  test("disables image editing while text is not recognized after uploading", async () => {
    fetchMock = mockSettings({ autoOcr: false });
    await renderApp(<SettingsDialog open onClose={mock()} />);
    tab("Bildbearbeitung");
    expect(radio(/^Auto-Rotation/).disabled).toBe(true);
    expect(checkbox(/Automatisch entzerren/).disabled).toBe(true);
    expect(screen.getByText(/Gilt nur, wenn unter „OCR“/)).toBeTruthy();

    tab("OCR");
    fireEvent.click(checkbox(/Nach dem Upload erkennen/));
    tab("Bildbearbeitung");
    expect(radio(/^Auto-Rotation/).disabled).toBe(false);
  });

  test("closes without saving on Abbrechen", async () => {
    fetchMock = mockSettings();
    const onClose = mock();
    await renderApp(<SettingsDialog open onClose={onClose} />);
    tab("Bildbearbeitung");
    fireEvent.click(radio(/^Auto-Rotation/));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  test("moves the OCR switches this browser stored before to the server once", async () => {
    localStorage.setItem("archivar.autoOcr", "false");
    localStorage.setItem("archivar.ocrAllText", "true");
    fetchMock = mockSettings();
    await renderApp(<SettingsDialog open onClose={mock()} />);
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({ autoOcr: false, ocrAllText: true });
    expect(localStorage.getItem("archivar.autoOcr")).toBeNull();
    tab("OCR");
    expect(checkbox(/Nach dem Upload erkennen/).checked).toBe(false);
    expect(checkbox(/Alle Textteile erkennen/).checked).toBe(true);
  });
});
