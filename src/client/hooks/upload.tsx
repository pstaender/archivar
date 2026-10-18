import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { matchPath, useLocation } from "react-router";
import type { ArchiveDocument } from "../../shared/types";
import { isSupportedUpload } from "../../shared/uploads";
import { api, ApiRequestError, type UploadOptions } from "../api";
import { folderFromPathname } from "../routes";
import { useConfig } from "./config";
import { useFolders } from "./folders";
import { useJobs } from "./jobs";
import { useSettings } from "./settings";
import { useToast } from "./toast";
import { useTranslation } from "react-i18next";

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
  /** Counts the files uploaded so far, so pages can show them as soon as each one is stored. */
  version: number;
  upload: (files: File[], options?: UploadOptions) => Promise<ArchiveDocument[]>;
  uploadToCurrentTarget: (files: File[]) => Promise<ArchiveDocument[]>;
}

const UploadContext = createContext<UploadApi | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { t } = useTranslation();
  const { convertibleImageTypes } = useConfig();
  const { reload: reloadFolders } = useFolders();
  const { reload: reloadJobs } = useJobs();
  const location = useLocation();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [version, setVersion] = useState(0);
  const { autoOcr, ocrAllText } = useSettings().settings;
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
      const supported = files.filter((file) => isSupportedUpload(file, convertibleImageTypes));
      const skipped = files.length - supported.length;
      if (skipped > 0) {
        toast.show(
          t("upload.skipped", { count: skipped }),
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
        const duplicates: { file: File; titles: string[] }[] = [];
        const failures: { file: File; error: unknown }[] = [];
        // The import job shows the files on the jobs page; uploads still work without it.
        const job = await api.createJob({ kind: "import", files: supported.map((file) => file.name) }).catch((error) => {
          console.warn("Could not create the import job:", error);
          return null;
        });
        if (job) void reloadJobs();
        for (const [index, file] of supported.entries()) {
          const jobItem = job?.items[index];
          s.currentSize = file.size;
          s.currentBytes = 0;
          publish();
          try {
            const uploaded = await api.upload([file], { ocr: autoOcr, ocrAllText, ...options, jobItemId: jobItem?.id }, (loaded, total) => {
              s.currentBytes = file.size * (loaded / total);
              publish();
            });
            docs.push(...uploaded);
            const known = uploaded.flatMap((doc) => doc.duplicates.map((other) => other.title));
            if (known.length) duplicates.push({ file, titles: known });
            setVersion((v) => v + 1);
          } catch (error) {
            failures.push({ file, error });
            if (job && jobItem) void api.failJobItem(job.id, jobItem.id, error instanceof ApiRequestError ? error.serverMessage : error instanceof Error ? error.message : String(error)).catch(() => undefined);
          } finally {
            s.done++;
            s.doneBytes += file.size;
            s.currentBytes = 0;
            s.currentSize = 0;
            if (s.done >= s.total) stats.current = null;
            publish();
          }
        }

        if (job) void reloadJobs();
        if (docs.length > 0) {
          toast.success(t("upload.uploaded", { count: docs.length }));
          if (options.folders?.length) void reloadFolders();
        }
        const [duplicate] = duplicates;
        if (duplicates.length === 1 && duplicate) {
          toast.show(t("upload.duplicate", { name: duplicate.file.name, titles: duplicate.titles.map((title) => t("quoted", { text: title })).join(", ") }), "warning");
        } else if (duplicates.length > 1) {
          toast.show(t("upload.duplicates", { count: duplicates.length }), "warning");
        }
        const [first] = failures;
        if (failures.length === 1 && first) {
          toast.error(`${first.file.name}: ${first.error instanceof Error ? first.error.message : String(first.error)}`);
        } else if (failures.length > 1) {
          toast.error(t("upload.failed", { count: failures.length }));
        }
        return docs;
      };

      const result = queue.current.then(run);
      queue.current = result.catch(() => undefined);
      return result;
    },
    [autoOcr, ocrAllText, convertibleImageTypes, toast, reloadFolders, reloadJobs, publish, t],
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
    () => ({ progress, version, upload, uploadToCurrentTarget }),
    [progress, version, upload, uploadToCurrentTarget],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload(): UploadApi {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error("useUpload must be used inside UploadProvider");
  return ctx;
}

/** Calls `refresh` (a background reload) each time an upload stored another file. */
export function useRefreshOnUpload(refresh: () => void): void {
  const { version } = useUpload();
  const seen = useRef(version);
  useEffect(() => {
    if (version === seen.current) return;
    seen.current = version;
    refresh();
  }, [version, refresh]);
}
