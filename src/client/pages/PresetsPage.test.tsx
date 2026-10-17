import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import type { ImagePreset } from "../../shared/presets";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { FolderTree } from "../components/FolderTree";
import { PresetsPage } from "./PresetsPage";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

function setup(presets: ImagePreset[], settings = {}) {
  let stored = [...presets];
  fetchMock = mockFetch({
    "GET /api/folders": () => [],
    "GET /api/config": () => ({}),
    "GET /api/settings": () => ({ ...DEFAULT_USER_SETTINGS, ...settings }),
    "PATCH /api/settings": (_url, init) => ({ ...DEFAULT_USER_SETTINGS, ...JSON.parse(String(init.body)) }),
    "GET /api/presets": () => stored,
    "PATCH /api/presets/1": (_url, init) => {
      stored = stored.map((p) => (p.id === 1 ? { ...p, ...JSON.parse(String(init.body)) } : p));
      return stored[0];
    },
    "DELETE /api/presets/1": () => {
      stored = stored.filter((p) => p.id !== 1);
      return undefined;
    },
  });
  return renderApp(<PresetsPage />);
}

const preset = (id: number, name: string, steps: ImagePreset["steps"]): ImagePreset => ({ id, name, steps, createdAt: "" });

describe("PresetsPage", () => {
  test("lists the presets with their steps and marks the import preset", async () => {
    await setup([preset(1, "Beleg", { autoDewarp: true, autoBw: true }), preset(2, "Hell", { brightness: 0.1 })], { importPresetId: 2 });
    expect(screen.getByRole("heading", { name: "Bildeinstellungen" })).toBeTruthy();
    const steps = screen.getByRole("list", { name: "Schritte von Beleg" });
    expect(Array.from(steps.children).map((li) => li.textContent)).toEqual(["Automatisch entzerren", "Automatisch SW"]);
    expect(screen.getByRole("heading", { name: "Hell Beim Import" })).toBeTruthy();
    expect(screen.getByText("Helligkeit +10 %")).toBeTruthy();
  });

  test("renames and edits a preset", async () => {
    await setup([preset(1, "Beleg", { autoBw: true, denoise: 1 })]);
    fireEvent.click(screen.getByRole("button", { name: "Beleg bearbeiten" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kassenbon" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Entrauschen: Leicht" }));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(screen.getByText("Kassenbon")).toBeTruthy());
    expect(fetchMock.calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Kassenbon", steps: { autoBw: true } });
  });

  test("deleting the import preset turns it off", async () => {
    await setup([preset(1, "Beleg", { autoBw: true })], { importPresetId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Beleg löschen" }));
    expect(screen.getByText(/bei Imports angewendet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Löschen" }));
    await waitFor(() => expect(screen.getByText(/Noch keine Bildeinstellungen/)).toBeTruthy());
    expect(screen.queryByText("Beleg")).toBeNull();
    expect(fetchMock.calls.find((c) => c.path === "/api/settings" && c.method === "PATCH")?.body).toEqual({ importPresetId: null });
  });
});

test("the sidebar links to the presets page with their number", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/presets": () => [preset(1, "Beleg", { autoBw: true }), preset(2, "Hell", { brightness: 0.1 })] });
  await renderApp(<FolderTree />);
  const link = screen.getByRole("link", { name: /Bildeinstellungen/ });
  expect(link.getAttribute("href")).toBe("/presets");
  expect(link.textContent).toBe("Bildeinstellungen2");
});
