import type { BunRequest } from "bun";
import type { AppConfig, DocumentUpdate, EditSettings, Rotation, StackCreate, StackUpdate } from "../shared/types";
import type { AppContext } from "./context";
import { toPublicDocument } from "./db/documents";
import { handle, HttpError, json, noContent, parseId, readJson } from "./http";
import { derivedKeys } from "./storage";

type Req = BunRequest<string>;

function parseFolderList(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch {
    return [value];
  }
}

async function serveFile(file: Bun.BunFile, type: string, filename?: string): Promise<Response> {
  if (!(await file.exists())) throw new HttpError(404, "File not found");
  const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": "private, max-age=31536000, immutable" };
  if (filename) headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return new Response(file, { headers });
}

export function createApiRoutes(ctx: AppContext) {
  const { archive } = ctx;
  const userId = (req: Request) => ctx.currentUser(req).id;

  return {
    "/api/me": {
      GET: handle((req: Req) => json(ctx.currentUser(req))),
    },

    "/api/config": {
      GET: handle(() => json({ dewarpAvailable: ctx.dewarp.available() } satisfies AppConfig)),
    },

    "/api/library": {
      GET: handle((req: Req) => {
        const url = new URL(req.url);
        return json(
          archive.library(userId(req), {
            folder: url.searchParams.get("folder") ?? undefined,
            q: url.searchParams.get("q") ?? undefined,
          }),
        );
      }),
    },

    "/api/documents": {
      GET: handle((req: Req) => {
        const url = new URL(req.url);
        const stackId = url.searchParams.get("stackId");
        return json(
          ctx.documents
            .list(userId(req), {
              folder: url.searchParams.get("folder") ?? undefined,
              q: url.searchParams.get("q") ?? undefined,
              stackId: stackId ? parseId(stackId) : undefined,
            })
            .map(toPublicDocument),
        );
      }),
      POST: handle(async (req: Req) => {
        let form: FormData;
        try {
          form = await req.formData();
        } catch {
          throw new HttpError(400, "Expected multipart/form-data");
        }
        const files = await Promise.all(
          form
            .getAll("files")
            .filter((entry): entry is File => entry instanceof File)
            .map(async (file) => ({ name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) })),
        );
        const stackId = form.get("stackId");
        const docs = await archive.upload(userId(req), files, {
          folders: parseFolderList(form.get("folders")),
          stackId: typeof stackId === "string" && stackId ? parseId(stackId) : undefined,
          runOcr: form.get("ocr") === "true",
          ocrAllText: form.get("ocrAllText") === "true",
        });
        return json(docs, 201);
      }),
    },

    "/api/documents/:id": {
      GET: handle((req: Req) => json(toPublicDocument(archive.getDocument(userId(req), parseId(req.params.id))))),
      PATCH: handle(async (req: Req) =>
        json(await archive.updateDocument(userId(req), parseId(req.params.id), await readJson<DocumentUpdate>(req))),
      ),
      DELETE: handle(async (req: Req) => {
        await archive.deleteDocument(userId(req), parseId(req.params.id));
        return noContent();
      }),
    },

    "/api/documents/:id/ocr": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ allText?: boolean }>(req).catch(() => ({ allText: false }));
        return json(archive.requestOcr(userId(req), parseId(req.params.id), { allText: body.allText === true }), 202);
      }),
    },

    "/api/documents/:id/dewarp": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ rotation?: number }>(req).catch(() => ({ rotation: 0 }));
        const rotation = [0, 90, 180, 270].includes(Number(body.rotation)) ? (Number(body.rotation) as Rotation) : 0;
        return json(await archive.detectDewarp(userId(req), parseId(req.params.id), rotation));
      }),
    },

    "/api/documents/:id/auto-bw": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ editSettings?: Partial<EditSettings> }>(req).catch(() => ({ editSettings: undefined }));
        return json(await archive.autoBw(userId(req), parseId(req.params.id), body.editSettings));
      }),
    },

    "/api/documents/:id/file": {
      GET: handle((req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(doc.storageKey), doc.mimeType, doc.originalName);
      }),
    },

    "/api/documents/:id/preview": {
      GET: handle((req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(derivedKeys.preview(doc.id)), "image/jpeg");
      }),
    },

    "/api/documents/:id/image": {
      GET: handle((req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(derivedKeys.processed(doc.id)), "image/jpeg");
      }),
    },

    "/api/documents/:id/thumbnail": {
      GET: handle((req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(derivedKeys.thumbnail(doc.id)), "image/jpeg");
      }),
    },

    "/api/stacks": {
      GET: handle((req: Req) => json(ctx.stacks.list(userId(req)))),
      POST: handle(async (req: Req) => json(archive.createStack(userId(req), await readJson<StackCreate>(req)), 201)),
    },

    "/api/stacks/:id": {
      GET: handle((req: Req) => json(archive.getStackWithDocuments(userId(req), parseId(req.params.id)))),
      PATCH: handle(async (req: Req) => {
        const stack = archive.updateStack(userId(req), parseId(req.params.id), await readJson<StackUpdate>(req));
        return stack ? json(stack) : noContent();
      }),
      DELETE: handle((req: Req) => {
        archive.deleteStack(userId(req), parseId(req.params.id));
        return noContent();
      }),
    },

    "/api/stacks/:id/documents": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ documentIds: number[] }>(req);
        return json(archive.addToStack(userId(req), parseId(req.params.id), body.documentIds));
      }),
    },

    "/api/folders": {
      GET: handle((req: Req) => json(ctx.folders.list(userId(req)))),
      POST: handle(async (req: Req) => {
        const { path } = await readJson<{ path: string }>(req);
        const id = ctx.folders.ensure(userId(req), String(path ?? ""));
        return json(ctx.folders.find(userId(req), id), 201);
      }),
    },

    "/api/folders/:id": {
      PATCH: handle(async (req: Req) => {
        const { path } = await readJson<{ path: string }>(req);
        ctx.folders.rename(userId(req), parseId(req.params.id), String(path ?? ""));
        return json(ctx.folders.list(userId(req)));
      }),
      DELETE: handle((req: Req) => {
        ctx.folders.delete(userId(req), parseId(req.params.id));
        return noContent();
      }),
    },

    "/api/*": () => json({ error: "Not found" }, 404),
  };
}
