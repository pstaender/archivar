import type {
  AppConfig,
  ArchiveDocument,
  DewarpGrid,
  DocumentUpdate,
  Folder,
  LibraryItem,
  LibraryQuery,
  Rotation,
  StackCreate,
  StackUpdate,
  StackWithDocuments,
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiRequestError(res.status, body?.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const jsonBody = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const s = search.toString();
  return s ? `?${s}` : "";
}

export interface UploadOptions {
  folders?: string[];
  stackId?: number;
  ocr?: boolean;
}

export const api = {
  me: () => request<User>("/api/me"),
  config: () => request<AppConfig>("/api/config"),

  library: (params: LibraryQuery = {}) => request<LibraryItem[]>(`/api/library${query({ folder: params.folder, q: params.q })}`),

  document: (id: number) => request<ArchiveDocument>(`/api/documents/${id}`),
  updateDocument: (id: number, update: DocumentUpdate) => request<ArchiveDocument>(`/api/documents/${id}`, jsonBody("PATCH", update)),
  deleteDocument: (id: number) => request<void>(`/api/documents/${id}`, { method: "DELETE" }),
  detectDewarp: (id: number, rotation: Rotation) =>
    request<DewarpGrid>(`/api/documents/${id}/dewarp`, jsonBody("POST", { rotation })),
  runOcr: (id: number) => request<ArchiveDocument>(`/api/documents/${id}/ocr`, { method: "POST" }),

  upload(files: File[], options: UploadOptions = {}) {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    if (options.folders?.length) form.append("folders", JSON.stringify(options.folders));
    if (options.stackId !== undefined) form.append("stackId", String(options.stackId));
    if (options.ocr) form.append("ocr", "true");
    return request<ArchiveDocument[]>("/api/documents", { method: "POST", body: form });
  },

  stack: (id: number) => request<StackWithDocuments>(`/api/stacks/${id}`),
  createStack: (input: StackCreate) => request<StackWithDocuments>("/api/stacks", jsonBody("POST", input)),
  updateStack: (id: number, update: StackUpdate) =>
    request<StackWithDocuments | undefined>(`/api/stacks/${id}`, jsonBody("PATCH", update)),
  addToStack: (id: number, documentIds: number[]) =>
    request<StackWithDocuments>(`/api/stacks/${id}/documents`, jsonBody("POST", { documentIds })),
  deleteStack: (id: number) => request<void>(`/api/stacks/${id}`, { method: "DELETE" }),

  folders: () => request<Folder[]>("/api/folders"),
  createFolder: (path: string) => request<Folder>("/api/folders", jsonBody("POST", { path })),
  renameFolder: (id: number, path: string) => request<Folder[]>(`/api/folders/${id}`, jsonBody("PATCH", { path })),
  deleteFolder: (id: number) => request<void>(`/api/folders/${id}`, { method: "DELETE" }),
};

export type DocumentAsset = "file" | "preview" | "image" | "thumbnail";

export function assetUrl(doc: Pick<ArchiveDocument, "id" | "updatedAt">, asset: DocumentAsset): string {
  return `/api/documents/${doc.id}/${asset}?v=${encodeURIComponent(doc.updatedAt)}`;
}
