import { regionPlan } from "./areas";
import { vectorizer } from "./backend";
import type { VectorizerRequest, VectorizerResponse } from "./protocol";
import { suggestVectorSettings } from "./settings";
import type { RgbaImage } from "./types";

declare const self: { onmessage: ((event: MessageEvent<VectorizerRequest>) => void) | null; postMessage(message: VectorizerResponse): void };

let loaded: { url: string; bitmap: Promise<ImageBitmap> } | null = null;

function load(url: string): Promise<ImageBitmap> {
  if (loaded?.url !== url) {
    const bitmap = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Bild konnte nicht geladen werden (${response.status})`);
      return createImageBitmap(await response.blob());
    });
    bitmap.catch(() => loaded?.bitmap === bitmap && (loaded = null));
    loaded = { url, bitmap };
  }
  return loaded.bitmap;
}

async function region(request: VectorizerRequest): Promise<{ image: RgbaImage; pixelScale: number }> {
  const bitmap = await load(request.url);
  const plan = regionPlan(request.area, bitmap.width, bitmap.height);
  if (!plan) throw new Error("Der Bereich ist leer");
  const canvas = new OffscreenCanvas(plan.outWidth, plan.outHeight);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, plan.left, plan.top, plan.width, plan.height, 0, 0, plan.outWidth, plan.outHeight);
  const { data } = ctx.getImageData(0, 0, plan.outWidth, plan.outHeight);
  return { image: { width: plan.outWidth, height: plan.outHeight, data }, pixelScale: plan.pixelScale };
}

self.onmessage = async ({ data: request }) => {
  try {
    const { image, pixelScale } = await region(request);
    if (request.type === "suggest") {
      self.postMessage({ type: "suggested", id: request.id, settings: suggestVectorSettings(image, pixelScale) });
      return;
    }
    const start = performance.now();
    const graphic = vectorizer.vectorize(image, request.settings, pixelScale);
    self.postMessage({ type: "vectorized", id: request.id, graphic, ms: performance.now() - start });
  } catch (error) {
    self.postMessage({ type: "error", id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
};
