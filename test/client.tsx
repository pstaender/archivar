import { mock } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import type { ArchiveDocument, Folder, LibraryItem, Stack, UploadedDocument } from "../src/shared/types";
import { DEFAULT_EDIT_SETTINGS } from "../src/shared/editSettings";
import { AppProviders } from "../src/client/App";

export type Handler = (url: URL, init: RequestInit) => unknown | Response | Promise<unknown>;

export interface FetchMock {
  calls: { method: string; path: string; body: unknown }[];
  restore(): void;
}

// Loaded by every page through the providers; tests that care mock them themselves.
const defaultRoutes: Record<string, Handler> = {
  "GET /api/presets": () => [],
  "GET /api/jobs": () => [],
  "GET /api/auth/status": () => ({ user: { id: 1, name: "admin", admin: true }, passwordSet: false, usernameRequired: false, passkeyLogin: false }),
};

export function mockFetch(routes: Record<string, Handler>): FetchMock {
  const original = globalThis.fetch;
  const calls: FetchMock["calls"] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost:3000");
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, path: url.pathname + url.search, body });
    const key = `${method} ${url.pathname}`;
    const handler = routes[key] ?? defaultRoutes[key];
    if (!handler) return Response.json({ error: `No mock for ${key}` }, { status: 404 });
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    if (result === undefined) return new Response(null, { status: 204 });
    return Response.json(result);
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function renderApp(ui: ReactElement, { path = "/", route = "*" }: { path?: string; route?: string } = {}) {
  const router = createMemoryRouter([{ path: route, element: <AppProviders>{ui}</AppProviders> }], { initialEntries: [path] });
  const result = render(<RouterProvider router={router} />);
  await settle();
  return { ...result, router };
}

let nextId = 1;

/** Opens a document tab, also one in the „Mehr“ menu. */
export function selectTab(name: string): void {
  const tab = screen.queryByRole("tab", { name });
  if (tab && tab.getAttribute("aria-haspopup") === null) {
    fireEvent.click(tab);
    return;
  }
  const trigger = document.querySelector<HTMLElement>('[role="tab"][aria-haspopup="menu"]');
  if (!trigger) throw new Error(`No tab „${name}“`);
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

export function makeDocument(overrides: Partial<ArchiveDocument> = {}): ArchiveDocument {
  const id = overrides.id ?? nextId++;
  return {
    id,
    title: `Dokument ${id}`,
    originalName: `doc-${id}.jpg`,
    mimeType: "image/jpeg",
    kind: "image",
    size: 1234,
    width: 100,
    height: 140,
    pageCount: null,
    stackId: null,
    stackPosition: 0,
    editSettings: { ...DEFAULT_EDIT_SETTINGS },
    shapes: [],
    shapesOutdated: false,
    vectorCount: 0,
    vectorsOutdated: false,
    ocrText: "",
    ocrStatus: "none",
    ocrConfidence: null,
    ocrError: null,
    ocrRemoved: 0,
    ocrAllText: false,
    ocrLanguage: null,
    ocrLanguages: null,
    metadata: {},
    folders: [],
    copyOf: null,
    copies: [],
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    ...overrides,
  };
}

/** A document as the upload response returns it. */
export function makeUpload(overrides: Partial<ArchiveDocument> = {}): UploadedDocument {
  return { ...makeDocument(overrides), duplicates: [] };
}

export function makeStack(overrides: Partial<Stack> = {}): Stack {
  const id = overrides.id ?? nextId++;
  return {
    id,
    title: `Stapel ${id}`,
    folders: [],
    documentIds: [],
    coverDocumentId: null,
    createdAt: "2026-03-01T10:00:00.000Z",
    updatedAt: "2026-03-01T10:00:00.000Z",
    ...overrides,
  };
}

export const docItem = (document: ArchiveDocument): LibraryItem => ({ type: "document", document });
export const stackItem = (stack: Stack): LibraryItem => ({ type: "stack", stack });

export const folder = (id: number, path: string, documentCount = 0): Folder => ({ id, path, documentCount, stackCount: 0 });

export interface XhrUpload {
  path: string;
  body: FormData;
  progress(loaded: number, total: number): void;
  respond(status: number, body: unknown): void;
  abort(): void;
  timeout(): void;
}

// fetch() mocks do not cover uploads: they go through XMLHttpRequest for progress events.
export function mockXhr(): { uploads: XhrUpload[]; restore(): void } {
  const original = globalThis.XMLHttpRequest;
  const uploads: XhrUpload[] = [];
  class FakeXhr {
    status = 0;
    statusText = "";
    response: unknown = null;
    responseType = "";
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    private path = "";
    open(_method: string, path: string) {
      this.path = path;
    }
    send(body: FormData) {
      uploads.push({
        path: this.path,
        body,
        progress: (loaded, total) => this.upload.onprogress?.({ lengthComputable: true, loaded, total }),
        respond: (status, response) => {
          this.status = status;
          this.response = response;
          this.onload?.();
        },
        abort: () => this.onabort?.(),
        timeout: () => this.ontimeout?.(),
      });
    }
  }
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  return {
    uploads,
    restore: () => {
      globalThis.XMLHttpRequest = original;
    },
  };
}
