import { DEFAULT_EDIT_SETTINGS, isDefaultEditSettings } from "../../shared/editSettings";
import { autoBwVariants } from "../../shared/image/autoBw";
import { Jimp, type JimpImage } from "../../shared/image/jimp";
import { applyEdits, scaleToFit } from "../../shared/image/pipeline";
import type { RawImage } from "../../shared/image/raw";
import { PREVIEW_SIZE } from "../../shared/preview";
import { drawShapes } from "../../shared/shapes";
import { paintVectorAreas } from "../../vectorizer/server/paint";
import { loadOpenCv } from "../opencv";
import { type ImageSource, type ImageTaskInput, type ImageTaskName, type ImageTaskRequest, type ImageTaskResponse, type ImageTaskResult, THUMBNAIL_SIZE } from "./imageTasks";

declare const self: Worker;

const JPEG_QUALITY = 90;
// Compression artifacts in the editor's base image would show up in its threshold and contrast preview.
const PREVIEW_JPEG_QUALITY = 95;
const ORIENTATION_SIZE = 2000;
const CROP_ANALYSIS_SIZE = 1024;
// Applying a preset analyses the same image several times; it is decoded once and dropped when no task follows.
const CACHE_IDLE_MS = 10_000;

async function toJpeg(image: JimpImage, quality = JPEG_QUALITY): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await image.getBuffer("image/jpeg", { quality }));
}

function previewJpeg(original: JimpImage): Promise<Uint8Array> {
  return toJpeg(scaleToFit(original.clone() as JimpImage, PREVIEW_SIZE), PREVIEW_JPEG_QUALITY);
}

function rawImage({ bitmap }: JimpImage): RawImage {
  const { data, width, height } = bitmap;
  const owned = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data : new Uint8Array(data);
  return { width, height, data: new Uint8Array(owned.buffer, 0, owned.byteLength) };
}

let cached: { key: string; image: JimpImage } | null = null;
let dropCache: Timer | undefined;

/** The decoded image; callers must not modify it (clone first), as later tasks reuse it. */
async function decode({ key, data }: ImageSource): Promise<JimpImage> {
  clearTimeout(dropCache);
  if (cached?.key !== key) {
    cached = null;
    cached = { key, image: (await Jimp.read(Buffer.from(data))) as JimpImage };
  }
  dropCache = setTimeout(() => (cached = null), CACHE_IDLE_MS);
  dropCache.unref();
  return cached.image;
}

const tasks: { [K in ImageTaskName]: (input: ImageTaskInput<K>) => Promise<ImageTaskResult<K>> } = {
  async size({ data }) {
    const { width, height } = (await Jimp.read(Buffer.from(data))).bitmap;
    return { width, height };
  },

  async preview({ source }) {
    return previewJpeg(await decode(source));
  },

  async render({ source, settings, shapes, vectors, layered, preview }) {
    const original = await decode(source);
    const edited = isDefaultEditSettings(settings) ? original : applyEdits(original, settings);
    const { width, height } = edited.bitmap;
    let processed = edited;
    if (layered) {
      processed = edited.clone() as JimpImage;
      if (vectors.length > 0) await paintVectorAreas(processed.bitmap, vectors);
      drawShapes(processed.bitmap, shapes);
    }
    return {
      width,
      height,
      preview: preview ? await previewJpeg(original) : null,
      edited: layered ? await toJpeg(edited) : null,
      processed: await toJpeg(processed),
      thumbnail: await toJpeg(scaleToFit(processed.clone() as JimpImage, THUMBNAIL_SIZE), 80),
    };
  },

  async renderJpeg({ source, settings }) {
    const original = await decode(source);
    return toJpeg(isDefaultEditSettings(settings) ? original : applyEdits(original, settings));
  },

  async edited({ source, settings }) {
    const original = await decode(source);
    return rawImage(isDefaultEditSettings(settings) ? (original.clone() as JimpImage) : applyEdits(original, settings));
  },

  async orientationInput({ source }) {
    const image = scaleToFit((await decode(source)).clone() as JimpImage, ORIENTATION_SIZE);
    return new Uint8Array(await image.getBuffer("image/png"));
  },

  async upright({ source, rotation }) {
    const original = await decode(source);
    return rawImage(rotation === 0 ? original.clone() as JimpImage : (original.clone().rotate(-rotation) as JimpImage));
  },

  async cropInput({ source, settings: { rotation, dewarp } }) {
    const scaled = scaleToFit((await decode(source)).clone() as JimpImage, CROP_ANALYSIS_SIZE);
    return rawImage(applyEdits(scaled, { ...DEFAULT_EDIT_SETTINGS, rotation, dewarp }));
  },

  async autoBw({ source, settings }) {
    return autoBwVariants(await decode(source), settings);
  },
};

function transferables(result: unknown): ArrayBuffer[] {
  if (result instanceof Uint8Array) return [result.buffer as ArrayBuffer];
  if (!result || typeof result !== "object") return [];
  return Object.values(result).flatMap((value) => (value instanceof Uint8Array ? [value.buffer as ArrayBuffer] : []));
}

const ready = loadOpenCv();
let queue = Promise.resolve();

self.onmessage = (event: MessageEvent<ImageTaskRequest>) => {
  const { id, task, input } = event.data;
  queue = queue.then(async () => {
    let response: ImageTaskResponse;
    try {
      await ready;
      const result = await (tasks[task] as (input: unknown) => Promise<unknown>)(input);
      response = { id, result };
    } catch (error) {
      response = { id, error: error instanceof Error ? error.message : String(error) };
    }
    self.postMessage(response, transferables("result" in response ? response.result : null));
  });
};
