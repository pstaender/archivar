import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import type { ImagePreset } from "../../shared/presets";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { PresetList } from "./PresetList";

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
  return renderApp(<PresetList />);
}

const preset = (id: number, name: string, steps: ImagePreset["steps"]): ImagePreset => ({ id, name, steps, createdAt: "" });

describe("PresetList", () => {
  test("lists the presets with their steps in gray", async () => {
    await setup([preset(1, "Beleg", { autoDewarp: true, autoBw: true }), preset(2, "Hell", { brightness: 0.1 })]);
    expect(screen.getByText("Beleg")).toBeTruthy();
    expect(screen.getByText("Automatisch entzerren, Automatisch SW").className).toBe("preset-list__summary");
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
    await waitFor(() => expect(screen.getByText("Im Tab „Bearbeiten“ speichern")).toBeTruthy());
    expect(screen.queryByText("Beleg")).toBeNull();
    expect(fetchMock.calls.find((c) => c.path === "/api/settings" && c.method === "PATCH")?.body).toEqual({ importPresetId: null });
  });
});
