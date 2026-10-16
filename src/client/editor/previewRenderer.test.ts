import { describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { EditSettings } from "../../shared/types";
import { PreviewRenderer, type WorkerLike, type WorkerRequest, type WorkerResponse } from "./previewRenderer";

class FakeWorker implements WorkerLike {
  requests: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: WorkerRequest) {
    this.requests.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  reply(response: WorkerResponse) {
    this.onmessage!({ data: response } as MessageEvent<WorkerResponse>);
  }

  rendered(request: WorkerRequest) {
    this.reply({ type: "rendered", id: request.id, width: 2, height: 1, data: new Uint8ClampedArray(8), ms: 12 });
  }
}

const settings = (brightness: number): EditSettings => ({ ...DEFAULT_EDIT_SETTINGS, brightness });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("PreviewRenderer", () => {
  test("loads the image in the worker", async () => {
    const worker = new FakeWorker();
    const loaded = new PreviewRenderer(worker).load("/api/documents/1/preview", 1200);
    expect(worker.requests).toEqual([{ type: "load", id: 1, url: "/api/documents/1/preview", maxSize: 1200 }]);
    worker.reply({ type: "loaded", id: 1, width: 1200, height: 900 });
    expect(await loaded).toEqual({ width: 1200, height: 900 });
  });

  test("renders one at a time and skips renders replaced while waiting", async () => {
    const worker = new FakeWorker();
    const renderer = new PreviewRenderer(worker);
    const first = renderer.render(settings(0.1));
    const second = renderer.render(settings(0.2));
    const third = renderer.render(settings(0.3));
    expect(worker.requests.map((r) => r.type === "render" && r.settings.brightness)).toEqual([0.1]);
    expect(await second).toBeNull();

    worker.rendered(worker.requests[0]!);
    expect(await first).toMatchObject({ width: 2, height: 1, ms: 12 });
    await tick();
    expect(worker.requests.map((r) => r.type === "render" && r.settings.brightness)).toEqual([0.1, 0.3]);

    worker.rendered(worker.requests[1]!);
    expect(await third).toMatchObject({ width: 2 });
  });

  test("passes worker errors on and keeps rendering afterwards", async () => {
    const worker = new FakeWorker();
    const renderer = new PreviewRenderer(worker);
    const failed = renderer.render(settings(0.1));
    worker.reply({ type: "error", id: 1, message: "kaputt" });
    await expect(failed).rejects.toThrow("kaputt");
    await tick();

    const next = renderer.render(settings(0.2));
    await tick();
    worker.rendered(worker.requests[1]!);
    expect(await next).not.toBeNull();
  });

  test("rejects open requests when the worker script fails or the renderer is disposed", async () => {
    const worker = new FakeWorker();
    const renderer = new PreviewRenderer(worker);
    const loading = renderer.load("/x");
    worker.onerror!({ message: "Script error" } as ErrorEvent);
    await expect(loading).rejects.toThrow("Script error");

    const rendering = renderer.render(settings(0.1));
    const waiting = renderer.render(settings(0.2));
    renderer.dispose();
    expect(worker.terminated).toBe(true);
    expect(await waiting).toBeNull();
    await expect(rendering).rejects.toThrow("Renderer disposed");
  });
});
