import { mkdir } from "node:fs/promises";
import index from "../client/index.html";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { openDatabase } from "./db/database";
import { createApiRoutes } from "./routes";
import { UvdocEngine } from "./services/dewarp";
import { loadOpenCv } from "./opencv";
import { MagickConverter } from "./services/magick";
import { TesseractEngine } from "./services/ocr";
import { vendorRoutes } from "./vendor";

const config = loadConfig();
await mkdir(config.storageDir, { recursive: true });
await mkdir(config.ocrCacheDir, { recursive: true });

await loadOpenCv();

const ocrEngine = new TesseractEngine(config.ocrLanguages, config.ocrCacheDir);
const dewarpEngine = new UvdocEngine(config.uvdocModelPath);
if (!dewarpEngine.available()) console.warn(`UVDoc model not found at ${config.uvdocModelPath}, automatic dewarping is disabled.`);
const imageConverter = await MagickConverter.detect();
if (imageConverter) console.log(`ImageMagick found, also accepting ${imageConverter.types().join(", ")}.`);
else console.warn("ImageMagick not found, HEIC/AVIF/WebP/JPEG XL/JPEG 2000 uploads are not supported.");
const ctx = createContext({ db: openDatabase(config.databasePath), storageDir: config.storageDir, ocrEngine, dewarpEngine, imageConverter });
const detected = ctx.archive.detectMissingLanguages();
if (detected > 0) console.log(`Detected the language of ${detected} documents.`);
const resumed = ctx.ocr.resume();
if (resumed > 0) console.log(`Resumed text recognition for ${resumed} documents.`);
const resumedJobs = ctx.jobQueue.resume();
if (resumedJobs > 0) console.log(`Resumed batch processing for ${resumedJobs} documents.`);
ctx.imaging
  .removeStalePreviews()
  .then((count) => count > 0 && console.log(`Removed ${count} outdated preview files.`))
  .catch((error) => console.warn("Could not remove outdated preview files:", error));

const development = process.env.NODE_ENV !== "production";
const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes,
  development: development && { hmr: true, console: true },
  routes: {
    ...createApiRoutes(ctx),
    ...vendorRoutes({ development }),
    "/*": index,
  },
});

console.log(`Archivar running at ${server.url}`);

async function shutdown() {
  await server.stop();
  await ocrEngine.terminate();
  ctx.db.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
