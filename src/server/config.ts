import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface Config {
  port: number;
  dataDir: string;
  databasePath: string;
  storageDir: string;
  ocrLanguages: string[];
  ocrCacheDir: string;
  maxUploadBytes: number;
  uvdocModelPath: string;
  segmentationModelPath: string;
  /** Public origin for passkeys, e.g. `https://archiv.example.org`; otherwise taken from each request. */
  origin: string | null;
}

type Env = Record<string, string | undefined>;

/** The per-user application data directory of the OS. */
export function appDataDir(env: Env = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  if (platform === "win32") return env.APPDATA || join(home, "AppData", "Roaming");
  if (platform === "darwin") return join(home, "Library", "Application Support");
  return env.XDG_CONFIG_HOME || join(home, ".config");
}

export function defaultDataDir(env: Env = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string {
  return join(appDataDir(env, platform, home), "archivar", "data");
}

export function loadConfig(env: Env = process.env): Config {
  const dataDir = resolve(env.ARCHIVAR_DATA_DIR || defaultDataDir(env));
  return {
    port: Number(env.PORT ?? 3000),
    dataDir,
    databasePath: env.ARCHIVAR_DATABASE ?? join(dataDir, "archivar.sqlite"),
    storageDir: join(dataDir, "files"),
    ocrLanguages: (env.ARCHIVAR_OCR_LANGS ?? "deu+eng").split("+").filter(Boolean),
    ocrCacheDir: join(dataDir, "tessdata"),
    maxUploadBytes: Number(env.ARCHIVAR_MAX_UPLOAD_MB ?? 512) * 1024 * 1024,
    uvdocModelPath: resolve(env.ARCHIVAR_UVDOC_MODEL ?? "models/uvdoc.onnx"),
    segmentationModelPath: resolve(env.ARCHIVAR_DOCSEG_MODEL ?? "models/docseg.onnx"),
    origin: env.ARCHIVAR_ORIGIN?.replace(/\/+$/, "") || null,
  };
}
