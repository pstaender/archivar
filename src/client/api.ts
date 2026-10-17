import { PREVIEW_SIZE } from "../shared/preview";
import type { Job, JobCreate } from "../shared/jobs";
import type { ImagePreset, ImagePresetInput } from "../shared/presets";
import type { PdfQuality, UserSettings } from "../shared/settings";
import type { Shape } from "../shared/shapes";
import type { VectorArea } from "../vectorizer";
import type { ApiToken, CreatedApiToken } from "../shared/tokens";
import type {
  AppConfig,
  ArchiveDocument,
  BwVariant,
  DewarpGrid,
  DocumentUpdate,
  EditSettings,
  Folder,
  LibraryItem,
  LibraryItemRef,
  LibraryQuery,
  Quad,
  Rotation,
  StackCreate,
  StackUpdate,
  StackWithDocuments,
  UploadedDocument,
  User,
} from "../shared/types";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiRequestError(res.status, body?.error ?? res.statusText);
  }
  return res;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// fetch() cannot report upload progress, XMLHttpRequest can.
function sendWithProgress<T>(path: string, body: FormData, onProgress?: (loaded: number, total: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      const response = xhr.response as (T & { error?: string }) | null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(response as T);
      else reject(new ApiRequestError(xhr.status, response?.error ?? (xhr.statusText || "Upload fehlgeschlagen")));
    };
    xhr.onerror = () => reject(new ApiRequestError(0, "Upload fehlgeschlagen"));
    // Without these the promise would never settle and block the upload queue until the page is reloaded.
    xhr.onabort = () => reject(new ApiRequestError(0, "Upload abgebrochen"));
    xhr.ontimeout = () => reject(new ApiRequestError(0, "Zeitüberschreitung beim Upload"));
    xhr.send(body);
  });
}

const jsonBody = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

async function download(res: Response, fallbackName: string): Promise<{ blob: Blob; filename: string }> {
  const encoded = res.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
  return { blob: await res.blob(), filename: encoded ? decodeURIComponent(encoded) : fallbackName };
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface OcrRequest {
  allText?: boolean;
  languages?: string[] | null;
}

export interface UploadOptions {
  folders?: string[];
  stackId?: number;
  ocr?: boolean;
  ocrAllText?: boolean;
  /** Item of the import job that follows this upload. */
  jobItemId?: number;
}

export const api = {
  me: () => request<User>("/api/me"),
  settings: () => request<UserSettings>("/api/settings"),
  updateSettings: (update: Partial<UserSettings>) => request<UserSettings>("/api/settings", jsonBody("PATCH", update)),
  config: () => request<AppConfig>("/api/config"),

  library: (params: LibraryQuery = {}) =>
    request<LibraryItem[]>(`/api/library${query({ folder: params.folder, q: params.q, sort: params.sort })}`),
  /** Stores the order of the items arranged by the user in a folder. */
  saveFolderOrder: (folder: string, items: LibraryItemRef[]) => request<void>("/api/folders/order", jsonBody("PUT", { folder, items })),

  document: (id: number) => request<ArchiveDocument>(`/api/documents/${id}`),
  updateDocument: (id: number, update: DocumentUpdate) => request<ArchiveDocument>(`/api/documents/${id}`, jsonBody("PATCH", update)),
  vectors: (id: number) => request<{ areas: VectorArea[]; outdated: boolean }>(`/api/documents/${id}/vectors`),
  saveVectors: (id: number, areas: VectorArea[]) =>
    request<{ document: ArchiveDocument; areas: VectorArea[] }>(`/api/documents/${id}/vectors`, jsonBody("PUT", { areas })),
  deleteDocument: (id: number) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  detectDewarp: (id: number, rotation: Rotation) =>
    request<DewarpGrid>(`/api/documents/${id}/dewarp`, jsonBody("POST", { rotation })),
  detectOrientation: (id: number) => request<{ rotation: Rotation | null }>(`/api/documents/${id}/orientation`, jsonBody("POST", {})),
  autoCrop: (id: number, editSettings: EditSettings) =>
    request<{ corners: Quad | null }>(`/api/documents/${id}/auto-crop`, jsonBody("POST", { editSettings })),
  autoBw: (id: number, editSettings: EditSettings) =>
    request<BwVariant[]>(`/api/documents/${id}/auto-bw`, jsonBody("POST", { editSettings })),
  /** The settings after applying a preset on top of `editSettings` (default: the stored ones); nothing is saved. */
  applyPreset: (id: number, presetId: number, editSettings?: EditSettings) =>
    request<{ editSettings: EditSettings; shapes: Shape[] | null }>(`/api/documents/${id}/apply-preset`, jsonBody("POST", { presetId, editSettings })),
  /** Searchable PDF of the edited image with its stored text; without `quality`, the user's setting applies. */
  exportPdf: async (id: number, quality?: PdfQuality) => download(await send(`/api/documents/${id}/pdf`, jsonBody("POST", { quality })), `dokument-${id}.pdf`),
  /** One PDF of the documents in order: images as searchable pages, PDFs with all pages; other files are left out. */
  exportCombinedPdf: async (documentIds: number[], title?: string, quality?: PdfQuality) =>
    download(await send("/api/export/pdf", jsonBody("POST", { documentIds, title, quality })), "Dokumente.pdf"),
  renderPreview: async (id: number, editSettings: EditSettings, signal?: AbortSignal) =>
    (await send(`/api/documents/${id}/render`, { ...jsonBody("POST", { editSettings }), signal })).blob(),
  /** `languages` changes the document's recognition languages (null: back to the default). */
  runOcr: (id: number, options: OcrRequest = {}) =>
    request<ArchiveDocument>(`/api/documents/${id}/ocr`, jsonBody("POST", { allText: options.allText === true, languages: options.languages })),

  upload(files: File[], options: UploadOptions = {}, onProgress?: (loaded: number, total: number) => void) {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (options.folders?.length) form.append("folders", JSON.stringify(options.folders));
    if (options.stackId !== undefined) form.append("stackId", String(options.stackId));
    if (options.ocr) form.append("ocr", "true");
    if (options.ocrAllText) form.append("ocrAllText", "true");
    if (options.jobItemId !== undefined) form.append("jobItemId", String(options.jobItemId));
    return sendWithProgress<UploadedDocument[]>("/api/documents", form, onProgress);
  },

  stack: (id: number) => request<StackWithDocuments>(`/api/stacks/${id}`),
  createStack: (input: StackCreate) => request<StackWithDocuments>("/api/stacks", jsonBody("POST", input)),
  updateStack: (id: number, update: StackUpdate) =>
    request<StackWithDocuments | undefined>(`/api/stacks/${id}`, jsonBody("PATCH", update)),
  addToStack: (id: number, documentIds: number[]) =>
    request<StackWithDocuments>(`/api/stacks/${id}/documents`, jsonBody("POST", { documentIds })),
  deleteStack: (id: number) => request<void>(`/api/stacks/${id}`, { method: "DELETE" }),

  jobs: () => request<Job[]>("/api/jobs"),
  createJob: (input: JobCreate) => request<Job>("/api/jobs", jsonBody("POST", input)),
  deleteJob: (id: number) => request<void>(`/api/jobs/${id}`, { method: "DELETE" }),
  /** Marks an upload of an import job that never reached the server as failed. */
  failJobItem: (jobId: number, itemId: number, error: string) => request<void>(`/api/jobs/${jobId}/items/${itemId}`, jsonBody("PATCH", { error })),

  presets: () => request<ImagePreset[]>("/api/presets"),
  createPreset: (input: ImagePresetInput) => request<ImagePreset>("/api/presets", jsonBody("POST", input)),
  updatePreset: (id: number, input: ImagePresetInput) => request<ImagePreset>(`/api/presets/${id}`, jsonBody("PATCH", input)),
  deletePreset: (id: number) => request<void>(`/api/presets/${id}`, { method: "DELETE" }),

  tokens: () => request<ApiToken[]>("/api/tokens"),
  createToken: (name: string) => request<CreatedApiToken>("/api/tokens", jsonBody("POST", { name })),
  deleteToken: (id: number) => request<void>(`/api/tokens/${id}`, { method: "DELETE" }),

  folders: () => request<Folder[]>("/api/folders"),
  createFolder: (path: string) => request<Folder>("/api/folders", jsonBody("POST", { path })),
  renameFolder: (id: number, path: string) => request<Folder[]>(`/api/folders/${id}`, jsonBody("PATCH", { path })),
  deleteFolder: (id: number) => request<void>(`/api/folders/${id}`, { method: "DELETE" }),
};

export type DocumentAsset = "file" | "preview" | "image" | "edited" | "thumbnail";

export function assetUrl(doc: Pick<ArchiveDocument, "id" | "updatedAt">, asset: DocumentAsset): string {
  const version = encodeURIComponent(doc.updatedAt);
  return `/api/documents/${doc.id}/${asset}?v=${asset === "preview" ? `${version}-${PREVIEW_SIZE}` : version}`;
}
