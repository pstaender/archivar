import "../../shared/bufferGlobal";
import { createImage, type JimpImage } from "../../shared/image/jimp";
import { initOpenCv, isOpenCvReady } from "../../shared/image/opencv";
import { applyEdits } from "../../shared/image/pipeline";
import { OPENCV_URL } from "../../shared/opencvAsset";
import type { WorkerRequest, WorkerResponse } from "./previewRenderer";

// Bundled by the server as a classic worker (src/server/vendor.ts), so OpenCV.js can be loaded with importScripts.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  importScripts(url: string): void;
  cv?: unknown;
};

let image: JimpImage | null = null;
let queue = Promise.resolve();

scope.onmessage = ({ data }) => {
  queue = queue.then(() =>
    handle(data).catch((error) => scope.postMessage({ type: "error", id: data.id, message: error instanceof Error ? error.message : String(error) })),
  );
};

async function handle(request: WorkerRequest): Promise<void> {
  if (request.type === "load") {
    image = await decode(request.url, request.maxSize);
    scope.postMessage({ type: "loaded", id: request.id, width: image.bitmap.width, height: image.bitmap.height });
    return;
  }
  if (!image) throw new Error("No image loaded");
  if (request.settings.denoise > 0 && !isOpenCvReady()) {
    scope.importScripts(OPENCV_URL);
    await initOpenCv(scope.cv);
  }
  const start = performance.now();
  const { width, height, data } = applyEdits(image, request.settings).bitmap;
  const ms = performance.now() - start;
  const pixels =
    data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? new Uint8ClampedArray(data.buffer as ArrayBuffer)
      : Uint8ClampedArray.from(data);
  scope.postMessage({ type: "rendered", id: request.id, width, height, data: pixels, ms }, [pixels.buffer]);
}

async function decode(url: string, maxSize: number | null): Promise<JimpImage> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The image could not be loaded (${response.status})`);
  const bitmap = await createImageBitmap(await response.blob());
  const scale = maxSize ? Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height)) : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = new OffscreenCanvas(width, height).getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return createImage(width, height, ctx.getImageData(0, 0, width, height).data);
}
