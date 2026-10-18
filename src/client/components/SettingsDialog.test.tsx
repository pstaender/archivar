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

function mockSettings(stored = {}, presets: unknown[] = [], routes: Parameters<typeof mockFetch>[0] = {}) {
  return mockFetch({
    ...routes,
    "GET /api/presets": () => presets,
    "GET /api/folders": () => [],
    "GET /api/config": () => ({ dewarpAvailable: true, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
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

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bildgrößen", "Import", "Sprache", "API", "Zugriff"]);
    expect(radio(/^Original.*Volle Auflösung/).checked).toBe(true);
    expect(screen.getByText("Standard")).toBeTruthy();
    fireEvent.click(radio(/^Niedrig.*150 DPI/));

    tab("Import");
    expect(checkbox(/Text nach dem Upload erkennen/).checked).toBe(true);
    fireEvent.click(checkbox(/Alle Textteile erkennen/));

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({
      ...DEFAULT_USER_SETTINGS,
      pdfImageQuality: "low",
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
      { id: 3, name: "OCR Optimiert", steps: { autoRotate: true, autoBw: true, autoLevels: true }, createdAt: "" },
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

  test("chooses the language uploads are recognized in, or automatic detection", async () => {
    fetchMock = mockSettings();
    const onClose = mock();
    await renderApp(<SettingsDialog open onClose={onClose} />);
    tab("Import");
    const select = screen.getByLabelText("Sprache der Texterkennung") as HTMLSelectElement;
    expect(select.value).toBe("");
    await screen.findByText(/Erkennt zuerst mit Deutsch und Englisch/);
    fireEvent.change(select, { target: { value: "fra" } });
    expect(screen.getByText(/Gilt für alle hochgeladenen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ importOcrLanguages: ["fra"] });
  });

  test("creates API tokens, shows the new one once and deletes them", async () => {
    const existing = { id: 1, name: "Alt", prefix: "arch_abcdef", createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: null };
    fetchMock = mockSettings({}, [], {
      "GET /api/tokens": () => [existing],
      "POST /api/tokens": (_url, init) => ({ id: 2, name: JSON.parse(String(init.body)).name, prefix: "arch_xyz123", token: "arch_xyz123secret", createdAt: "2026-10-17T10:00:00.000Z", lastUsedAt: null }),
      "DELETE /api/tokens/1": () => undefined,
    });
    await renderApp(<SettingsDialog open onClose={() => {}} />);
    tab("API");
    await screen.findByText("Alt");
    expect(screen.getByText("noch nicht benutzt", { exact: false })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Neuer Token", { selector: "input:not([readonly])" }), { target: { value: "Scanner" } });
    fireEvent.click(screen.getByRole("button", { name: "Erstellen" }));
    const value = (await screen.findByDisplayValue("arch_xyz123secret")) as HTMLInputElement;
    expect(value.readOnly).toBe(true);
    expect(screen.getByText("Scanner")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Token „Alt“ löschen" }));
    await waitFor(() => expect(screen.queryByText("Alt") === null).toBe(true));
    expect(fetchMock.calls.filter((c) => c.method === "POST" || c.method === "DELETE").map((c) => `${c.method} ${c.path}`)).toEqual(["POST /api/tokens", "DELETE /api/tokens/1"]);
  });

  test("offers the archive export only to an admin with a password and asks before downloading", async () => {
    fetchMock = mockSettings({}, [], {
      "GET /api/auth/status": () => ({ user: { id: 1, name: "admin", admin: true }, passwordSet: true, usernameRequired: false, passkeyLogin: false }),
      "GET /api/export/archive/size": () => ({ bytes: 25 * 1024 * 1024 }),
    });
    const clicked: string[] = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute("href")!);
    };
    try {
      await renderApp(<SettingsDialog open onClose={() => {}} />);
      expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bildgrößen", "Import", "Sprache", "API", "Zugriff", "Export"]);
      tab("Export");
      fireEvent.click(screen.getByRole("button", { name: "Archiv exportieren" }));
      await waitFor(() => expect(screen.getByText("Möchtest du wirklich 25 MB herunterladen?")).toBeTruthy());
      expect(clicked).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Herunterladen" }));
      expect(clicked).toEqual(["/api/export/archive"]);
    } finally {
      HTMLAnchorElement.prototype.click = click;
    }
  });

  test("hides the archive export from users who are not admins", async () => {
    mockSettings({}, [], {
      "GET /api/auth/status": () => ({ user: { id: 2, name: "anna", admin: false }, passwordSet: true, usernameRequired: true, passkeyLogin: false }),
    });
    await renderApp(<SettingsDialog open onClose={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bildgrößen", "Import", "Sprache", "API", "Zugriff"]);
  });

  test("switches the interface language at once and remembers it in this browser", async () => {
    fetchMock = mockSettings();
    await renderApp(<SettingsDialog open onClose={() => {}} />);

    tab("Sprache");
    const select = screen.getByRole("combobox", { name: "Sprache der Oberfläche" }) as HTMLSelectElement;
    expect(select.value).toBe("de");
    fireEvent.change(select, { target: { value: "fr" } });

    await waitFor(() => expect(screen.getByRole("tab", { name: "Langue" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeTruthy();
    expect(localStorage.getItem("archivar.language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
    expect(fetchMock.calls.some((call) => call.method === "PATCH")).toBe(false);
  });
});
