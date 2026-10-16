import { join } from "node:path";
import { OPENCV_URL } from "../shared/opencvAsset";
import { PREVIEW_WORKER_URL } from "../shared/preview";

const IMMUTABLE = "public, max-age=31536000, immutable";

const WORKER_ENTRY = join(import.meta.dir, "../client/editor/preview.worker.ts");

interface BuiltWorker {
  js: Uint8Array<ArrayBuffer>;
  gzipped: Uint8Array<ArrayBuffer>;
  etag: string;
}

// Bun's HTML bundler leaves `new Worker(new URL(...))` alone, so the worker is bundled here. A classic (IIFE) worker
// can load OpenCV.js with importScripts.
async function buildWorker(development: boolean): Promise<BuiltWorker> {
  const result = await Bun.build({
    entrypoints: [WORKER_ENTRY],
    target: "browser",
    format: "iife",
    minify: !development,
    sourcemap: development ? "inline" : "none",
    define: { "process.env.NODE_ENV": JSON.stringify(development ? "development" : "production") },
  });
  if (!result.success) throw new AggregateError(result.logs, "Could not bundle the preview worker");
  const js = new Uint8Array(await result.outputs[0]!.arrayBuffer());
  return { js, gzipped: Bun.gzipSync(js), etag: `"${Bun.hash(js).toString(36)}"` };
}

export function vendorRoutes({ development = false } = {}) {
  const openCvPath = require.resolve("@techstark/opencv-js");
  let gzipped: Promise<Uint8Array<ArrayBuffer>> | null = null;

  let worker: Promise<BuiltWorker> | null = null;

  return {
    [PREVIEW_WORKER_URL]: async (req: Request) => {
      if (development || !worker) {
        const build = buildWorker(development);
        build.catch(() => worker === build && (worker = null));
        worker = build;
      }
      const { js, gzipped, etag } = await worker;
      const headers: Record<string, string> = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache", ETag: etag, Vary: "Accept-Encoding" };
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      if (!req.headers.get("accept-encoding")?.includes("gzip")) return new Response(js, { headers });
      return new Response(gzipped, { headers: { ...headers, "Content-Encoding": "gzip" } });
    },
    [OPENCV_URL]: async (req: Request) => {
      const headers = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": IMMUTABLE, Vary: "Accept-Encoding" };
      if (!req.headers.get("accept-encoding")?.includes("gzip")) return new Response(Bun.file(openCvPath), { headers });
      gzipped ??= Bun.file(openCvPath)
        .bytes()
        .then((bytes) => Bun.gzipSync(bytes));
      return new Response(await gzipped, { headers: { ...headers, "Content-Encoding": "gzip" } });
    },
  };
}
