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

function mockSettings(stored = {}, presets: unknown[] = []) {
  return mockFetch({
    "GET /api/presets": () => presets,
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
  test("shows image sizes and import on separate tabs and saves both", async () => {
    fetchMock = mockSettings({ pdfImageQuality: "original" });
    const onClose = mock();
    await renderApp(<SettingsDialog open onClose={onClose} />);

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bildgrößen", "Import"]);
    expect(radio(/^Original.*voller Auflösung/).checked).toBe(true);
    expect(screen.getByText("Standard")).toBeTruthy();
    fireEvent.click(radio(/^150 DPI/));

    tab("Import");
    expect(checkbox(/Text nach dem Upload erkennen/).checked).toBe(true);
    fireEvent.click(checkbox(/Alle Textteile erkennen/));

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      ...DEFAULT_USER_SETTINGS,
      pdfImageQuality: "150",
      ocrAllText: true,
    });
    expect(screen.getByText("Einstellungen gespeichert")).toBeTruthy();
  });

  test("closes without saving on Abbrechen", async () => {
    fetchMock = mockSettings();
    const onClose = mock();
    await renderApp(<SettingsDialog open onClose={onClose} />);
    tab("Import");
    fireEvent.click(checkbox(/Alle Textteile erkennen/));
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
    tab("Import");
    expect(checkbox(/Text nach dem Upload erkennen/).checked).toBe(false);
    expect(checkbox(/Alle Textteile erkennen/).checked).toBe(true);
  });

  test("chooses the image preset applied on import, or none, and folders to add uploads to", async () => {
    const presets = [
      { id: 3, name: "SW + Auto-Tonwerte + automatisch drehen", steps: { autoRotate: true, autoBw: true, autoLevels: true }, createdAt: "" },
      { id: 4, name: "Beleg", steps: { autoDewarp: true, autoBw: true }, createdAt: "" },
    ];
    fetchMock = mockSettings({ importPresetId: 3 }, presets);
    const onClose = mock();
    await renderApp(<SettingsDialog open onClose={onClose} />);
    tab("Import");
    const select = screen.getByLabelText("Bildeinstellung anwenden") as HTMLSelectElement;
    expect(select.value).toBe("3");
    expect(screen.getByText("Automatisch drehen, Automatisch SW, Auto-Tonwerte")).toBeTruthy();
    fireEvent.change(select, { target: { value: "" } });
    expect(screen.getByText(/Wird vor der Texterkennung/)).toBeTruthy();
    fireEvent.change(select, { target: { value: "4" } });
    expect(screen.getByText("Automatisch entzerren, Automatisch SW")).toBeTruthy();
    const folderInput = screen.getByLabelText("Zu Ordnern hinzufügen");
    fireEvent.change(folderInput, { target: { value: "eingang/ 2026 " } });
    fireEvent.keyDown(folderInput, { key: "Enter" });

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ importPresetId: 4, importFolders: ["eingang/2026"] });
  });
});
