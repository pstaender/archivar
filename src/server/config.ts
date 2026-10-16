import { join, resolve } from "node:path";

export interface Config {
  port: number;
  dataDir: string;
  databasePath: string;
  storageDir: string;
  ocrLanguages: string[];
  ocrCacheDir: string;
  maxUploadBytes: number;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const dataDir = resolve(env.ARCHIVAR_DATA_DIR ?? "data");
  return {
    port: Number(env.PORT ?? 3000),
    dataDir,
    databasePath: env.ARCHIVAR_DATABASE ?? join(dataDir, "archivar.sqlite"),
    storageDir: join(dataDir, "files"),
    ocrLanguages: (env.ARCHIVAR_OCR_LANGS ?? "deu+eng").split("+").filter(Boolean),
    ocrCacheDir: join(dataDir, "tessdata"),
    maxUploadBytes: Number(env.ARCHIVAR_MAX_UPLOAD_MB ?? 512) * 1024 * 1024,
  };
}
