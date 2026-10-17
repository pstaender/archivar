import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/server/context";
import { openDatabase } from "../src/server/db/database";
import { createApiRoutes } from "../src/server/routes";
import type { DewarpEngine } from "../src/server/services/dewarp";
import type { ImageConverter } from "../src/server/services/magick";
import type { OcrEngine, OcrResult, Orientation } from "../src/server/services/ocr";
import type { RawImage } from "../src/shared/image/raw";
import { createImage } from "../src/shared/image/jimp";

export class FakeOcrEngine implements OcrEngine {
  readonly languages = ["deu", "eng"];
  calls = 0;
  /** Languages passed to each recognize() call (undefined: the default). */
  recognizedLanguages: (string[] | undefined)[] = [];
  /** Images passed to recognize(). */
  images: Uint8Array[] = [];
  result: OcrResult = { text: "Hallo Welt", confidence: 91 };
  /** Results for explicitly requested languages (key: codes joined with "+"); others get `result`. */
  resultsByLanguage: Record<string, OcrResult> = {};
  error: Error | null = null;
  orientation: Orientation | null = { rotation: 0, confidence: 10 };
  orientationInputs = 0;
  /** Simulates a stuck Tesseract worker; `release()` lets the stuck calls finish. */
  hang = false;
  private stuck: (() => void)[] = [];
  terminations = 0;

  async detectOrientation(): Promise<Orientation | null> {
    this.orientationInputs++;
    return this.orientation;
  }

  async recognize(image: Uint8Array, languages?: string[]): Promise<OcrResult> {
    this.calls++;
    this.images.push(image);
    this.recognizedLanguages.push(languages);
    if (this.hang) return new Promise((resolve) => this.stuck.push(() => resolve(this.result)));
    if (this.error) throw this.error;
    return (languages && this.resultsByLanguage[languages.join("+")]) || this.result;
  }

  release(): void {
    this.hang = false;
    for (const finish of this.stuck.splice(0)) finish();
  }

  async terminate(): Promise<void> {
    this.terminations++;
  }
}

export function identityGrid(columns = 31, rows = 45): Float32Array {
  const points = new Float32Array(2 * columns * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      points[r * columns + c] = (c / (columns - 1)) * 2 - 1;
      points[columns * rows + r * columns + c] = (r / (rows - 1)) * 2 - 1;
    }
  }
  return points;
}

// Pretends to decode WebP; tests upload PNG bytes declared as image/webp.
export class FakeImageConverter implements ImageConverter {
  calls: string[] = [];

  types(): string[] {
    return ["image/webp"];
  }

  async toPng(data: Uint8Array, mimeType: string): Promise<Uint8Array> {
    this.calls.push(mimeType);
    return data;
  }
}

export class FakeDewarpEngine implements DewarpEngine {
  isAvailable = true;
  inputs: RawImage[] = [];

  available(): boolean {
    return this.isAvailable;
  }

  async predict(image: RawImage): Promise<Float32Array> {
    this.inputs.push(image);
    return identityGrid();
  }
}

export interface TestServer {
  url: string;
  ctx: AppContext;
  ocr: FakeOcrEngine;
  dewarp: FakeDewarpEngine;
  converter: FakeImageConverter;
  api(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

/**
 * `importPreset: false` (default) turns off the import preset every user starts with, so uploads stay untouched. OCR on
 * upload is off too, so uploads without an `ocr` field skip it.
 */
export async function startTestServer({ ocrPageTimeoutMs, importPreset = false }: { ocrPageTimeoutMs?: number; importPreset?: boolean } = {}): Promise<TestServer> {
  const dir = await mkdtemp(join(tmpdir(), "archivar-test-"));
  const ocr = new FakeOcrEngine();
  const dewarp = new FakeDewarpEngine();
  const converter = new FakeImageConverter();
  const ctx = createContext({
    db: openDatabase(":memory:"),
    storageDir: join(dir, "files"),
    ocrEngine: ocr,
    dewarpEngine: dewarp,
    imageConverter: converter,
    ocrPageTimeoutMs,
  });
  ctx.users.updateSettings(ctx.users.findByName("default")!.id, importPreset ? { autoOcr: false } : { autoOcr: false, importPresetId: null });
  const server = Bun.serve({ port: 0, routes: createApiRoutes(ctx) });
  const url = server.url.toString().replace(/\/$/, "");
  return {
    url,
    ctx,
    ocr,
    dewarp,
    converter,
    api: (path, init) => fetch(`${url}${path}`, init),
    async close() {
      await ctx.jobQueue.idle();
      await ctx.ocr.idle();
      await server.stop(true);
      ctx.db.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function makeJpeg(width = 64, height = 48, rgb: [number, number, number] = [200, 100, 50]): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return new Uint8Array(await createImage(width, height, data).getBuffer("image/jpeg"));
}

export function uploadForm(files: { name: string; data: Uint8Array; type?: string }[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", new File([file.data as Uint8Array<ArrayBuffer>], file.name, { type: file.type ?? "" }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}
