import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { matchPath, useLocation } from "react-router";
import type { ArchiveDocument } from "../../shared/types";
import { api, type UploadOptions } from "../api";
import { folderFromPathname } from "../routes";
import { useFolders } from "./folders";
import { useToast } from "./toast";

const AUTO_OCR_KEY = "archivar.autoOcr";
const OCR_ALL_TEXT_KEY = "archivar.ocrAllText";

interface UploadApi {
  uploading: number;
  version: number;
  autoOcr: boolean;
  setAutoOcr: (value: boolean) => void;
  ocrAllText: boolean;
  setOcrAllText: (value: boolean) => void;
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
  const [uploading, setUploading] = useState(0);
  const [version, setVersion] = useState(0);
  const [autoOcr, setAutoOcr] = useStoredFlag(AUTO_OCR_KEY, true);
  const [ocrAllText, setOcrAllText] = useStoredFlag(OCR_ALL_TEXT_KEY, false);

  const upload = useCallback(
    async (files: File[], options: UploadOptions = {}) => {
      if (files.length === 0) return [];
      setUploading((n) => n + files.length);
      try {
        const docs = await api.upload(files, { ocr: autoOcr, ocrAllText, ...options });
        toast.success(docs.length === 1 ? "1 Datei hochgeladen" : `${docs.length} Dateien hochgeladen`);
        setVersion((v) => v + 1);
        if (options.folders?.length) void reloadFolders();
        return docs;
      } catch (error) {
        toast.error(error);
        return [];
      } finally {
        setUploading((n) => n - files.length);
      }
    },
    [autoOcr, ocrAllText, toast, reloadFolders],
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
    () => ({ uploading, version, autoOcr, setAutoOcr, ocrAllText, setOcrAllText, upload, uploadToCurrentTarget }),
    [uploading, version, autoOcr, setAutoOcr, ocrAllText, setOcrAllText, upload, uploadToCurrentTarget],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadApi {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside UploadProvider");
  return ctx;
}
