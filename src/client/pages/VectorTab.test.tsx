import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DEFAULT_USER_SETTINGS } from "../../shared/settings";
import type { VectorizerRequest, VectorizerResponse } from "../../vectorizer/protocol";
import type { VectorArea } from "../../vectorizer";
import { type FetchMock, makeDocument, mockFetch, renderApp } from "../../../test/client";
import { DocumentPage } from "./DocumentPage";

const graphic = { width: 10, height: 10, background: "#ffffff", paths: [{ d: "M0 0L5 0L5 10L0 10Z", fill: "#000000" }] };
const bw = { mode: "bw" as const, detail: 4, curves: "smooth" as const, threshold: 140 };
const stored: VectorArea = { id: "a", x: 0.1, y: 0.1, width: 0.3, height: 0.2, settings: bw, graphic };

class FakeWorker {
  static requests: VectorizerRequest[] = [];
  onmessage: ((event: MessageEvent<VectorizerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(request: VectorizerRequest) {
    FakeWorker.requests.push(request);
    const response: VectorizerResponse =
      request.type === "suggest" ? { type: "suggested", id: request.id, settings: bw } : { type: "vectorized", id: request.id, graphic, ms: 5 };
    queueMicrotask(() => this.onmessage?.({ data: response } as MessageEvent<VectorizerResponse>));
  }
  terminate() {}
}

let fetchMock: FetchMock;
const originalWorker = globalThis.Worker;
beforeEach(() => {
  FakeWorker.requests = [];
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
});
afterEach(() => {
  globalThis.Worker = originalWorker;
  fetchMock.restore();
  localStorage.clear();
});

async function open(overrides: Parameters<typeof makeDocument>[0] = {}) {
  let doc = makeDocument({ id: 1, ...overrides });
  let areas: VectorArea[] = doc.vectorCount > 0 ? [stored] : [];
  fetchMock = mockFetch({
    "GET /api/config": () => ({ dewarpAvailable: false, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] }),
    "GET /api/settings": () => DEFAULT_USER_SETTINGS,
    "GET /api/folders": () => [],
    "GET /api/documents/1": () => doc,
    "GET /api/documents/1/vectors": () => ({ areas, outdated: doc.vectorsOutdated }),
    "PUT /api/documents/1/vectors": (_url, init) => {
      areas = (JSON.parse(String(init.body)) as { areas: VectorArea[] }).areas;
      doc = { ...doc, vectorCount: areas.length, updatedAt: "2026-03-02T10:00:00.000Z" };
      return { document: doc, areas };
    },
  });
  localStorage.setItem("archivar.documentTab", "vectors");
  const view = await renderApp(<DocumentPage />, { path: "/documents/1", route: "/documents/:id" });
  await screen.findByRole("tab", { name: "Vektor" });
  return view;
}

function drawArea(container: HTMLElement) {
  const overlay = container.querySelector(".shape-overlay") as HTMLElement;
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  fireEvent.pointerDown(overlay, { button: 0, clientX: 20, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60, pointerId: 1 });
}

describe("Vektor tab", () => {
  test("sits between Text and Formen and shows the stored areas on the image without them", async () => {
    const view = await open({ vectorCount: 1, vectorsOutdated: true, ocrStatus: "done", ocrText: "Text" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Bearbeiten", "Text", "Vektor", "Formen", "Details"]);
    expect(view.container.querySelector(".editor-canvas__image")?.getAttribute("src")).toStartWith("/api/documents/1/edited?");
    const button = await screen.findByRole("button", { name: "Vektorbereich 1" });
    expect(button.querySelector("path")?.getAttribute("d")).toBe(graphic.paths[0]!.d);
    expect(screen.getByText(/Prüfe, ob die Bereiche noch an der richtigen Stelle liegen/)).toBeTruthy();
    expect(screen.getByText(/Nach dem Speichern wird der Text neu erkannt/)).toBeTruthy();
    expect(FakeWorker.requests).toEqual([]);
    expect((screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("a marked area gets suggested settings, is vectorized and saved", async () => {
    const view = await open();
    expect(fetchMock.calls.some((c) => c.path === "/api/documents/1/vectors")).toBe(false);
    drawArea(view.container);
    await waitFor(() => expect(FakeWorker.requests.map((r) => r.type)).toEqual(["suggest", "vectorize"]));
    const vectorize = FakeWorker.requests[1] as Extract<VectorizerRequest, { type: "vectorize" }>;
    expect(vectorize.settings).toEqual(bw);
    expect(vectorize.url).toStartWith("/api/documents/1/edited?");
    expect(vectorize.area).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    await screen.findByText("1 Bereich, 1 vektorisiert");
    expect((screen.getByRole("radio", { name: "Schwarzweiß" }) as HTMLElement).getAttribute("aria-checked")).toBe("true");

    const save = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(save);
    await screen.findByText("Vektoren gespeichert");
    const body = fetchMock.calls.find((c) => c.method === "PUT")?.body as { areas: VectorArea[] };
    expect(body.areas).toHaveLength(1);
    expect(body.areas[0]).toMatchObject({ x: 0.1, y: 0.1, width: 0.5, height: 0.5, settings: bw, graphic });
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  test("changing a setting vectorizes the area again", async () => {
    await open({ vectorCount: 1 });
    fireEvent.focus(await screen.findByRole("button", { name: "Vektorbereich 1" }));
    fireEvent.click(screen.getByRole("radio", { name: "Farben" }));
    await waitFor(() => expect(FakeWorker.requests.map((r) => r.type)).toEqual(["vectorize"]));
    expect((FakeWorker.requests[0] as Extract<VectorizerRequest, { type: "vectorize" }>).settings.mode).toBe("color");
    await waitFor(() => expect((screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    fireEvent.focus(screen.getByRole("button", { name: "Vektorbereich 1" }));
    await waitFor(() => expect((screen.getByRole("radio", { name: "Schwarzweiß" }) as HTMLElement).getAttribute("aria-checked") === "true").toBe(true));
  });
});
