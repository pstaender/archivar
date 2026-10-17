import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import { ImageEditor } from "./ImageEditor";
import type { WorkerRequest, WorkerResponse } from "./previewRenderer";

/** Answers loads at once and keeps renders running, like a slow preview. */
class SlowWorker {
  static all: SlowWorker[] = [];
  requests: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor() {
    SlowWorker.all.push(this);
  }

  postMessage(message: WorkerRequest) {
    this.requests.push(message);
    if (message.type === "load") {
      queueMicrotask(() => this.onmessage?.({ data: { type: "loaded", id: message.id, width: 800, height: 600 } } as MessageEvent<WorkerResponse>));
    }
  }

  terminate() {
    this.terminated = true;
  }
}

const original = globalThis.Worker;
beforeEach(() => {
  SlowWorker.all = [];
  globalThis.Worker = SlowWorker as unknown as typeof Worker;
});
afterEach(() => {
  globalThis.Worker = original;
});

describe("ImageEditor", () => {
  test("switching to another image while a preview renders shows no error", async () => {
    // Without act(), like in the browser: React re-renders after the disposed worker's request has already failed.
    const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const settings = { ...DEFAULT_EDIT_SETTINGS };
    try {
      root.render(<ImageEditor src="/a" settings={settings} mode="none" onCornersChange={() => {}} />);
      await waitFor(() => expect(SlowWorker.all[0]?.requests.some((r) => r.type === "render")).toBe(true));

      root.render(<ImageEditor src="/b" settings={settings} mode="none" onCornersChange={() => {}} />);
      await waitFor(() => expect(SlowWorker.all[1]?.requests.some((r) => r.type === "render")).toBe(true));
      expect(SlowWorker.all[0]!.terminated).toBe(true);
      expect(container.querySelector(".alert--error")).toBeNull();
    } finally {
      root.unmount();
      container.remove();
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
  });

  test("shows the shapes on top of the preview, but not while corners are edited", async () => {
    const shapes = [{ id: "a", type: "rect" as const, x: 0.1, y: 0.2, width: 0.3, height: 0.4, color: "#000000" }];
    const props = { src: "/a", settings: { ...DEFAULT_EDIT_SETTINGS }, onCornersChange: () => {}, shapes };
    const view = render(<ImageEditor {...props} mode="none" />);
    await waitFor(() => expect(view.container.querySelector(".shape-preview") !== null).toBe(true));
    const shape = view.container.querySelector<HTMLElement>(".shape-preview > span")!;
    expect([shape.style.left, shape.style.top, shape.style.width, shape.style.height]).toEqual(["10%", "20%", "30%", "40%"]);
    expect(shape.style.background).toBe("#000000");

    view.rerender(<ImageEditor {...props} mode="perspective" />);
    expect(view.container.querySelector(".shape-preview") === null).toBe(true);
    view.unmount();
  });
});
