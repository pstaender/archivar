import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, type AppContext } from "../src/server/context";
import { openDatabase } from "../src/server/db/database";
import { createApiRoutes } from "../src/server/routes";
import type { DewarpEngine } from "../src/server/services/dewarp";
import type { OcrEngine, OcrResult } from "../src/server/services/ocr";
import type { RawImage } from "../src/shared/image/raw";
import { createImage } from "../src/shared/image/jimp";

export class FakeOcrEngine implements OcrEngine {
  calls = 0;
  result: OcrResult = { text: "Hallo Welt", confidence: 91 };
  error: Error | null = null;

  async recognize(): Promise<OcrResult> {
    this.calls++;
    if (this.error) throw this.error;
    return this.result;
  }

  async terminate(): Promise<void> {}
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
  api(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export async function startTestServer(): Promise<TestServer> {
  const dir = await mkdtemp(join(tmpdir(), "archivar-test-"));
  const ocr = new FakeOcrEngine();
  const dewarp = new FakeDewarpEngine();
  const ctx = createContext({ db: openDatabase(":memory:"), storageDir: join(dir, "files"), ocrEngine: ocr, dewarpEngine: dewarp });
  const server = Bun.serve({ port: 0, routes: createApiRoutes(ctx) });
  const url = server.url.toString().replace(/\/$/, "");
  return {
    url,
    ctx,
    ocr,
    dewarp,
    api: (path, init) => fetch(`${url}${path}`, init),
    async close() {
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
