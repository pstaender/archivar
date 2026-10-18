import type { EditSettings } from "../../shared/types";
import { PREVIEW_WORKER_URL } from "../../shared/preview";
import { t } from "../i18n";

export type WorkerRequest =
  | { type: "load"; id: number; url: string; maxSize: number | null }
  | { type: "render"; id: number; settings: EditSettings };

export interface RenderedPreview {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
  ms: number;
}

export type WorkerResponse =
  | { type: "loaded"; id: number; width: number; height: number }
  | ({ type: "rendered"; id: number } & RenderedPreview)
  | { type: "error"; id: number; message: string };

export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/** Requests still running when the renderer is disposed end with this; nobody waits for their result any more. */
export class RendererDisposedError extends Error {
  constructor() {
    super("Renderer disposed");
  }
}

interface Pending {
  resolve(response: WorkerResponse): void;
  reject(error: Error): void;
}

interface QueuedRender {
  settings: EditSettings;
  resolve(preview: RenderedPreview | null): void;
  reject(error: Error): void;
}

/**
 * Runs the edit pipeline in a Web Worker on its own copy of the image. Only one render runs at a time; a render that
 * is still waiting when the next one is requested resolves with null instead of running.
 */
export class PreviewRenderer {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private busy = false;
  private queued: QueuedRender | null = null;
  private disposed = false;

  constructor(private worker: WorkerLike = new Worker(PREVIEW_WORKER_URL)) {
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      this.pending.delete(data.id);
      if (data.type === "error") pending?.reject(new Error(data.message));
      else pending?.resolve(data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.failAll(new Error(event.message || t("preview.renderFailed")));
    };
  }

  /** Loads the image from `url`, scaled to `maxSize` if given, and returns its size. */
  async load(url: string, maxSize: number | null = null): Promise<{ width: number; height: number }> {
    const response = await this.call({ type: "load", url, maxSize });
    if (response.type !== "loaded") throw new Error("Unexpected worker response");
    return { width: response.width, height: response.height };
  }

  render(settings: EditSettings): Promise<RenderedPreview | null> {
    return new Promise((resolve, reject) => {
      this.queued?.resolve(null);
      this.queued = { settings, resolve, reject };
      this.next();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.worker.terminate();
    this.queued?.resolve(null);
    this.queued = null;
    this.failAll(new RendererDisposedError());
  }

  private next(): void {
    if (this.busy || !this.queued) return;
    const { settings, resolve, reject } = this.queued;
    this.queued = null;
    this.busy = true;
    this.call({ type: "render", settings })
      .then((response) => {
        if (response.type !== "rendered") throw new Error("Unexpected worker response");
        const { width, height, data, ms } = response;
        resolve({ width, height, data, ms });
      })
      .catch(reject)
      .finally(() => {
        this.busy = false;
        this.next();
      });
  }

  private call(request: WithoutId<WorkerRequest>): Promise<WorkerResponse> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // A terminated worker would never answer.
      if (this.disposed) return reject(new RendererDisposedError());
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id });
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
