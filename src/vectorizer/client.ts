import { VECTORIZER_WORKER_URL } from "./index";
import type { VectorizerRequest, VectorizerResponse } from "./protocol";
import type { VectorArea, VectorGraphic, VectorSettings } from "./types";

type Rect = Pick<VectorArea, "x" | "y" | "width" | "height">;
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

export interface VectorizerWorker {
  postMessage(message: VectorizerRequest): void;
  onmessage: ((event: MessageEvent<VectorizerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

/** Requests that were running when `cancel()` was called end with this. */
export class VectorizeCancelledError extends Error {
  constructor() {
    super("Vektorisierung abgebrochen");
  }
}

/** Talks to the vectorizer worker; `cancel()` stops a running vectorization by replacing the worker. */
export class VectorizerClient {
  private worker: VectorizerWorker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(response: VectorizerResponse): void; reject(error: Error): void }>();

  constructor(private readonly createWorker: () => VectorizerWorker = () => new Worker(VECTORIZER_WORKER_URL)) {}

  /** Settings that suit the area of the image at `url`. */
  async suggest(url: string, area: Rect): Promise<VectorSettings> {
    const response = await this.call({ type: "suggest", url, area: { x: area.x, y: area.y, width: area.width, height: area.height } });
    if (response.type !== "suggested") throw new Error("Unexpected worker response");
    return response.settings;
  }

  async vectorize(url: string, area: Rect, settings: VectorSettings): Promise<VectorGraphic> {
    const response = await this.call({ type: "vectorize", url, area: { x: area.x, y: area.y, width: area.width, height: area.height }, settings });
    if (response.type !== "vectorized") throw new Error("Unexpected worker response");
    return response.graphic;
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new VectorizeCancelledError());
  }

  dispose(): void {
    this.cancel();
  }

  private call(request: WithoutId<VectorizerRequest>): Promise<VectorizerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (response) => (response.type === "error" ? reject(new Error(response.message)) : resolve(response)),
        reject,
      });
      this.ensureWorker().postMessage({ ...request, id } as VectorizerRequest);
    });
  }

  private ensureWorker(): VectorizerWorker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      this.pending.delete(data.id);
      pending?.resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      this.failAll(new Error(event.message || "Vektorisierung fehlgeschlagen"));
    };
    this.worker = worker;
    return worker;
  }

  private failAll(error: Error): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const p of pending) p.reject(error);
  }
}
