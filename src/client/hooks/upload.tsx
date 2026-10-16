import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { matchPath, useLocation, useSearchParams } from "react-router";
import type { ArchiveDocument } from "../../shared/types";
import { api, type UploadOptions } from "../api";
import { useFolders } from "./folders";
import { useToast } from "./toast";

const AUTO_OCR_KEY = "archivar.autoOcr";

interface UploadApi {
  uploading: number;
  version: number;
  autoOcr: boolean;
  setAutoOcr: (value: boolean) => void;
  upload: (files: File[], options?: UploadOptions) => Promise<ArchiveDocument[]>;
  uploadToCurrentTarget: (files: File[]) => Promise<ArchiveDocument[]>;
}

const UploadContext = createContext<UploadApi | null>(null);

function readAutoOcr(): boolean {
  try {
    return localStorage.getItem(AUTO_OCR_KEY) !== "false";
  } catch {
    return true;
  }
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { reload: reloadFolders } = useFolders();
  const location = useLocation();
  const [params] = useSearchParams();
  const [uploading, setUploading] = useState(0);
  const [version, setVersion] = useState(0);
  const [autoOcr, setAutoOcrState] = useState(readAutoOcr);

  const setAutoOcr = useCallback((value: boolean) => {
    setAutoOcrState(value);
    try {
      localStorage.setItem(AUTO_OCR_KEY, String(value));
    } catch {}
  }, []);

  const upload = useCallback(
    async (files: File[], options: UploadOptions = {}) => {
      if (files.length === 0) return [];
      setUploading((n) => n + files.length);
      try {
        const docs = await api.upload(files, { ocr: autoOcr, ...options });
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
    [autoOcr, toast, reloadFolders],
  );

  const stackMatch = matchPath("/stacks/:id", location.pathname);
  const folder = location.pathname === "/" ? params.get("folder") : null;

  const uploadToCurrentTarget = useCallback(
    (files: File[]) =>
      upload(files, {
        stackId: stackMatch ? Number(stackMatch.params.id) : undefined,
        folders: folder ? [folder] : undefined,
      }),
    [upload, stackMatch?.params.id, folder],
  );

  const value = useMemo(
    () => ({ uploading, version, autoOcr, setAutoOcr, upload, uploadToCurrentTarget }),
    [uploading, version, autoOcr, setAutoOcr, upload, uploadToCurrentTarget],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadApi {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside UploadProvider");
  return ctx;
}
