import { mkdir } from "node:fs/promises";
import index from "../client/index.html";
import { loadConfig } from "./config";
import { createContext } from "./context";
import { openDatabase } from "./db/database";
import { createApiRoutes } from "./routes";
import { TesseractEngine } from "./services/ocr";

const config = loadConfig();
await mkdir(config.storageDir, { recursive: true });
await mkdir(config.ocrCacheDir, { recursive: true });

const ocrEngine = new TesseractEngine(config.ocrLanguages, config.ocrCacheDir);
const ctx = createContext({ db: openDatabase(config.databasePath), storageDir: config.storageDir, ocrEngine });

const server = Bun.serve({
  port: config.port,
  maxRequestBodySize: config.maxUploadBytes,
  development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  routes: {
    ...createApiRoutes(ctx),
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
