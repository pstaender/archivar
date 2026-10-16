import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";
import { matchPath, useLocation } from "react-router";
import type { ArchiveDocument } from "../../shared/types";
import { isSupportedUpload } from "../../shared/uploads";
import { api, type UploadOptions } from "../api";
import { folderFromPathname } from "../routes";
import { useFolders } from "./folders";
import { useToast } from "./toast";

const AUTO_OCR_KEY = "archivar.autoOcr";
const OCR_ALL_TEXT_KEY = "archivar.ocrAllText";
const AUTO_DEWARP_KEY = "archivar.autoDewarp";

export interface UploadProgress {
  done: number;
  total: number;
  fraction: number;
  processing: boolean;
}

interface UploadStats {
  done: number;
  total: number;
  doneBytes: number;
  totalBytes: number;
  currentBytes: number;
  currentSize: number;
}

interface UploadApi {
  progress: UploadProgress | null;
  version: number;
  autoOcr: boolean;
  setAutoOcr: (value: boolean) => void;
  ocrAllText: boolean;
  setOcrAllText: (value: boolean) => void;
  autoDewarp: boolean;
  setAutoDewarp: (value: boolean) => void;
  upload: (files: File[], options?: UploadOptions) => Promise<ArchiveDocument[]>;
  uploadToCurrentTarget: (files: File[]) => Promise<ArchiveDocument[]>;
}

const UploadContext = createContext<UploadApi | null>(null);

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [flag, setFlag] = useState(() => readFlag(key, fallback));
  const update = useCallback(
    (value: boolean) => {
      setFlag(value);
      try {
        localStorage.setItem(key, String(value));
      } catch {}
    },
    [key],
  );
  return [flag, update];
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { reload: reloadFolders } = useFolders();
  const location = useLocation();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [version, setVersion] = useState(0);
  const [autoOcr, setAutoOcr] = useStoredFlag(AUTO_OCR_KEY, true);
  const [ocrAllText, setOcrAllText] = useStoredFlag(OCR_ALL_TEXT_KEY, false);
  const [autoDewarp, setAutoDewarp] = useStoredFlag(AUTO_DEWARP_KEY, false);
  const stats = useRef<UploadStats | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const publish = useCallback(() => {
    const s = stats.current;
    if (!s) return setProgress(null);
    setProgress({
      done: s.done,
      total: s.total,
      fraction: s.totalBytes > 0 ? Math.min(1, (s.doneBytes + s.currentBytes) / s.totalBytes) : 0,
      processing: s.currentSize > 0 && s.currentBytes >= s.currentSize,
    });
  }, []);

  const upload = useCallback(
    async (files: File[], options: UploadOptions = {}) => {
      const supported = files.filter(isSupportedUpload);
      const skipped = files.length - supported.length;
      if (skipped > 0) {
        toast.show(
          skipped === 1 ? "1 Datei wird nicht unterstützt und wurde übersprungen" : `${skipped} Dateien werden nicht unterstützt und wurden übersprungen`,
          "warning",
        );
      }
      if (supported.length === 0) return [];

      const s = (stats.current ??= { done: 0, total: 0, doneBytes: 0, totalBytes: 0, currentBytes: 0, currentSize: 0 });
      s.total += supported.length;
      s.totalBytes += supported.reduce((sum, file) => sum + file.size, 0);
      publish();

      const run = async () => {
        const docs: ArchiveDocument[] = [];
        const failures: { file: File; error: unknown }[] = [];
        for (const file of supported) {
          s.currentSize = file.size;
          s.currentBytes = 0;
          publish();
          try {
            const uploaded = await api.upload([file], { ocr: autoOcr, ocrAllText, autoDewarp: autoOcr && autoDewarp, ...options }, (loaded, total) => {
              s.currentBytes = file.size * (loaded / total);
              publish();
            });
            docs.push(...uploaded);
          } catch (error) {
            failures.push({ file, error });
          } finally {
            s.done++;
            s.doneBytes += file.size;
            s.currentBytes = 0;
            s.currentSize = 0;
            if (s.done >= s.total) stats.current = null;
            publish();
          }
        }

        if (docs.length > 0) {
          toast.success(docs.length === 1 ? "1 Datei hochgeladen" : `${docs.length} Dateien hochgeladen`);
          setVersion((v) => v + 1);
          if (options.folders?.length) void reloadFolders();
        }
        const [first] = failures;
        if (failures.length === 1 && first) {
          toast.error(`${first.file.name}: ${first.error instanceof Error ? first.error.message : String(first.error)}`);
        } else if (failures.length > 1) {
          toast.error(`${failures.length} Dateien konnten nicht hochgeladen werden`);
        }
        return docs;
      };

      const result = queue.current.then(run);
      queue.current = result.catch(() => undefined);
      return result;
    },
    [autoOcr, ocrAllText, autoDewarp, toast, reloadFolders, publish],
  );

  const stackMatch = matchPath("/stacks/:id", location.pathname);
  const folder = folderFromPathname(location.pathname);

  const uploadToCurrentTarget = useCallback(
    (files: File[]) =>
      upload(files, {
        stackId: stackMatch ? Number(stackMatch.params.id) : undefined,
        folders: folder ? [folder] : undefined,
      }),
    [upload, stackMatch?.params.id, folder],
  );

  const value = useMemo(
    () => ({ progress, version, autoOcr, setAutoOcr, ocrAllText, setOcrAllText, autoDewarp, setAutoDewarp, upload, uploadToCurrentTarget }),
    [progress, version, autoOcr, setAutoOcr, ocrAllText, setOcrAllText, autoDewarp, setAutoDewarp, upload, uploadToCurrentTarget],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadApi {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside UploadProvider");
  return ctx;
}
