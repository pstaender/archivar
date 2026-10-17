import type { RawImage } from "../../shared/image/raw";
import type { Shape } from "../../shared/shapes";
import type { BwVariant, EditSettings, Rotation } from "../../shared/types";
import type { VectorArea } from "../../vectorizer";

export const THUMBNAIL_SIZE = 480;

/** An encoded image and a key that identifies its content, so the worker can reuse the decoded image. */
export interface ImageSource {
  key: string;
  data: Uint8Array;
}

export interface RenderedImages {
  width: number;
  height: number;
  /** The editor's base image, only when asked for. */
  preview: Uint8Array | null;
  /** The edited image without shapes and vector areas, only when layered. */
  edited: Uint8Array | null;
  processed: Uint8Array;
  thumbnail: Uint8Array;
}

interface Tasks {
  size: { input: { data: Uint8Array }; result: { width: number; height: number } };
  render: {
    /** `layered`: shapes or vector areas are drawn on the image, so the edited image without them is kept as well. */
    input: { source: ImageSource; settings: EditSettings; shapes: Shape[]; vectors: VectorArea[]; layered: boolean; preview: boolean };
    result: RenderedImages;
  };
  preview: { input: { source: ImageSource }; result: Uint8Array };
  renderJpeg: { input: { source: ImageSource; settings: EditSettings }; result: Uint8Array<ArrayBuffer> };
  edited: { input: { source: ImageSource; settings: EditSettings }; result: RawImage };
  orientationInput: { input: { source: ImageSource }; result: Uint8Array };
  upright: { input: { source: ImageSource; rotation: Rotation }; result: RawImage };
  cropInput: { input: { source: ImageSource; settings: EditSettings }; result: RawImage };
  autoBw: { input: { source: ImageSource; settings: EditSettings }; result: BwVariant[] };
}

export type ImageTaskName = keyof Tasks;
export type ImageTaskInput<K extends ImageTaskName> = Tasks[K]["input"];
export type ImageTaskResult<K extends ImageTaskName> = Tasks[K]["result"];
export type ImageTaskRequest = { [K in ImageTaskName]: { id: number; task: K; input: ImageTaskInput<K> } }[ImageTaskName];
export type ImageTaskResponse = { id: number; result: unknown } | { id: number; error: string };

// Bun's workers can be unreferenced, so an idle worker does not keep the process alive; the DOM typings lack this.
type BunWorker = Worker & { ref(): void; unref(): void };

/**
 * Runs the image work (Jimp, OpenCV) in a worker thread. It is synchronous and takes seconds for large scans, which
 * would otherwise stop the server from answering any request meanwhile. Tasks run one after another.
 */
export class ImageWorker {
  private worker: BunWorker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();

  run<K extends ImageTaskName>(task: K, input: ImageTaskInput<K>): Promise<ImageTaskResult<K>> {
    const worker = this.spawn();
    const id = this.nextId++;
    if (this.pending.size === 0) worker.ref();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      worker.postMessage({ id, task, input } as ImageTaskRequest);
    });
  }

  private spawn(): BunWorker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL("./imageWorker.ts", import.meta.url)) as BunWorker;
    worker.unref();
    worker.onmessage = (event: MessageEvent<ImageTaskResponse>) => {
      const response = event.data;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (this.pending.size === 0) worker.unref();
      if ("error" in response) pending.reject(new Error(response.error));
      else pending.resolve(response.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.crashed(worker, new Error(`Image worker failed: ${event.message}`));
    };
    worker.addEventListener("close", () => this.crashed(worker, new Error("Image worker exited")));
    this.worker = worker;
    return worker;
  }

  private crashed(worker: BunWorker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    worker.terminate();
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

export const imageWorker = new ImageWorker();
