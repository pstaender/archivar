import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
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
});
