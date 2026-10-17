import { expect, test } from "bun:test";
import { VectorizeCancelledError, VectorizerClient, type VectorizerWorker } from "./client";
import type { VectorizerRequest, VectorizerResponse } from "./protocol";
import { DEFAULT_VECTOR_SETTINGS } from "./settings";

class FakeWorker implements VectorizerWorker {
  requests: VectorizerRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<VectorizerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: VectorizerRequest) {
    this.requests.push(message);
  }
  reply(response: VectorizerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<VectorizerResponse>);
  }
  terminate() {
    this.terminated = true;
  }
}

const area = { x: 0, y: 0, width: 0.5, height: 0.5 };
const graphic = { width: 1, height: 1, background: "#ffffff", paths: [] };

test("sends requests to one worker and resolves them by id", async () => {
  const workers: FakeWorker[] = [];
  const client = new VectorizerClient(() => {
    workers.push(new FakeWorker());
    return workers.at(-1)!;
  });
  const suggested = client.suggest("/img", area);
  const vectorized = client.vectorize("/img", area, DEFAULT_VECTOR_SETTINGS);
  const [first, second] = workers[0]!.requests;
  expect(workers).toHaveLength(1);
  expect(first).toEqual({ type: "suggest", id: 1, url: "/img", area });
  workers[0]!.reply({ type: "vectorized", id: second!.id, graphic, ms: 3 });
  workers[0]!.reply({ type: "suggested", id: first!.id, settings: { ...DEFAULT_VECTOR_SETTINGS, mode: "bw" } });
  expect((await suggested).mode).toBe("bw");
  expect(await vectorized).toEqual(graphic);
});

test("errors reject; cancel stops the worker and starts a new one for the next request", async () => {
  const workers: FakeWorker[] = [];
  const client = new VectorizerClient(() => {
    workers.push(new FakeWorker());
    return workers.at(-1)!;
  });
  const failing = client.vectorize("/img", area, DEFAULT_VECTOR_SETTINGS);
  workers[0]!.reply({ type: "error", id: 1, message: "kaputt" });
  expect(failing).rejects.toThrow("kaputt");

  const running = client.vectorize("/img", area, DEFAULT_VECTOR_SETTINGS);
  client.cancel();
  expect(running).rejects.toBeInstanceOf(VectorizeCancelledError);
  expect(workers[0]!.terminated).toBe(true);
  void client.suggest("/img", area);
  expect(workers).toHaveLength(2);
});
