import type { BunRequest } from "bun";
import { type AppConfig, type DocumentUpdate, type EditSettings, LIBRARY_SORTS, type LibraryItemRef, type LibrarySort, type Rotation, type StackCreate, type StackUpdate } from "../shared/types";
import { type ImagePresetInput, normalizePresetName, normalizePresetSteps } from "../shared/presets";
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

function parseSort(value: string | null): LibrarySort | undefined {
  if (value === null) return undefined;
  if (!LIBRARY_SORTS.includes(value as LibrarySort)) throw new HttpError(400, "Unknown sort");
  return value as LibrarySort;
}

function pdfResponse({ pdf, filename }: { pdf: Uint8Array<ArrayBuffer>; filename: string }): Response {
  return new Response(pdf, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
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

    "/api/settings": {
      GET: handle((req: Req) => json(ctx.users.settings(userId(req)))),
      PATCH: handle(async (req: Req) => json(ctx.users.updateSettings(userId(req), await readJson<unknown>(req)))),
    },

    "/api/config": {
      GET: handle(() =>
        json({
          dewarpAvailable: ctx.dewarp.available(),
          convertibleImageTypes: ctx.imaging.convertibleTypes(),
          ocrLanguages: ctx.ocrEngine.languages,
        } satisfies AppConfig),
      ),
    },

    "/api/library": {
      GET: handle((req: Req) => {
        const url = new URL(req.url);
        return json(
          archive.library(userId(req), {
            folder: url.searchParams.get("folder") ?? undefined,
            q: url.searchParams.get("q") ?? undefined,
            sort: parseSort(url.searchParams.get("sort")),
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
        const settings = ctx.users.settings(userId(req));
        const preset = settings.importPresetId === null ? null : ctx.presets.get(userId(req), settings.importPresetId);
        const docs = await archive.upload(userId(req), files, {
          folders: [...new Set([...parseFolderList(form.get("folders")), ...settings.importFolders])],
          stackId: typeof stackId === "string" && stackId ? parseId(stackId) : undefined,
          runOcr: form.get("ocr") === "true",
          ocrAllText: form.get("ocrAllText") === "true",
          preset: preset?.steps,
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
        const body = await readJson<{ allText?: boolean; languages?: unknown }>(req).catch(() => ({ allText: false, languages: undefined }));
        if (body.languages !== undefined && body.languages !== null && !Array.isArray(body.languages)) throw new HttpError(400, "languages must be a list");
        const languages = body.languages as string[] | null | undefined;
        return json(archive.requestOcr(userId(req), parseId(req.params.id), { allText: body.allText === true }, languages), 202);
      }),
    },

    "/api/documents/:id/dewarp": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ rotation?: number }>(req).catch(() => ({ rotation: 0 }));
        const rotation = [0, 90, 180, 270].includes(Number(body.rotation)) ? (Number(body.rotation) as Rotation) : 0;
        return json(await archive.detectDewarp(userId(req), parseId(req.params.id), rotation));
      }),
    },

    "/api/documents/:id/orientation": {
      POST: handle(async (req: Req) => json({ rotation: await archive.detectOrientation(userId(req), parseId(req.params.id)) })),
    },

    "/api/documents/:id/auto-crop": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ editSettings?: Partial<EditSettings> }>(req).catch(() => ({ editSettings: undefined }));
        return json({ corners: await archive.detectCrop(userId(req), parseId(req.params.id), body.editSettings) });
      }),
    },

    "/api/documents/:id/auto-bw": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ editSettings?: Partial<EditSettings> }>(req).catch(() => ({ editSettings: undefined }));
        return json(await archive.autoBw(userId(req), parseId(req.params.id), body.editSettings));
      }),
    },

    "/api/documents/:id/apply-preset": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ presetId?: unknown; editSettings?: Partial<EditSettings> }>(req);
        const preset = ctx.presets.get(userId(req), parseId(String(body.presetId)));
        if (!preset) throw new HttpError(404, "Preset not found");
        return json({ editSettings: await archive.applyPreset(userId(req), parseId(req.params.id), preset.steps, body.editSettings) });
      }),
    },

    "/api/documents/:id/render": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ editSettings?: Partial<EditSettings> }>(req).catch(() => ({ editSettings: undefined }));
        const jpeg = await archive.renderPreview(userId(req), parseId(req.params.id), body.editSettings);
        return new Response(jpeg, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
      }),
    },

    "/api/export/pdf": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ documentIds?: unknown; title?: unknown }>(req);
        if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) throw new HttpError(400, "documentIds required");
        const ids = body.documentIds.map((id) => parseId(String(id)));
        const title = typeof body.title === "string" ? body.title : undefined;
        return pdfResponse(await archive.exportCombinedPdf(userId(req), ids, title, ctx.users.settings(userId(req)).pdfImageQuality));
      }),
    },

    "/api/documents/:id/pdf": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ text?: unknown }>(req).catch(() => ({ text: undefined }));
        const text = typeof body.text === "string" ? body.text : undefined;
        return pdfResponse(await archive.exportPdf(userId(req), parseId(req.params.id), text, ctx.users.settings(userId(req)).pdfImageQuality));
      }),
    },

    "/api/documents/:id/file": {
      GET: handle((req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(doc.storageKey), doc.mimeType, doc.originalName);
      }),
    },

    "/api/documents/:id/preview": {
      GET: handle(async (req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(await ctx.imaging.preview(doc)), "image/jpeg");
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

    "/api/presets": {
      GET: handle((req: Req) => json(ctx.presets.list(userId(req)))),
      POST: handle(async (req: Req) => {
        const body = await readJson<ImagePresetInput>(req);
        const name = normalizePresetName(body.name);
        const steps = normalizePresetSteps(body.steps);
        if (!name) throw new HttpError(400, "Name required");
        if (Object.keys(steps).length === 0) throw new HttpError(400, "Keine Einstellungen gewählt");
        return json(ctx.presets.create(userId(req), name, steps), 201);
      }),
    },

    "/api/presets/:id": {
      PATCH: handle(async (req: Req) => {
        const body = await readJson<ImagePresetInput>(req);
        const name = body.name === undefined ? undefined : normalizePresetName(body.name);
        const steps = body.steps === undefined ? undefined : normalizePresetSteps(body.steps);
        if (name === "") throw new HttpError(400, "Name required");
        if (steps && Object.keys(steps).length === 0) throw new HttpError(400, "Keine Einstellungen gewählt");
        const preset = ctx.presets.update(userId(req), parseId(req.params.id), { name, steps });
        if (!preset) throw new HttpError(404, "Preset not found");
        return json(preset);
      }),
      DELETE: handle((req: Req) => {
        const id = parseId(req.params.id);
        if (!ctx.presets.delete(userId(req), id)) throw new HttpError(404, "Preset not found");
        if (ctx.users.settings(userId(req)).importPresetId === id) ctx.users.updateSettings(userId(req), { importPresetId: null });
        return noContent();
      }),
    },

    "/api/folders/order": {
      PUT: handle(async (req: Req) => {
        const body = await readJson<{ folder?: unknown; items?: unknown }>(req);
        if (typeof body.folder !== "string" || !Array.isArray(body.items)) throw new HttpError(400, "folder and items required");
        const items = body.items.map((item): LibraryItemRef => {
          const { type, id } = (item ?? {}) as { type?: unknown; id?: unknown };
          if ((type !== "document" && type !== "stack") || !Number.isInteger(id)) throw new HttpError(400, "Invalid item");
          return { type, id: id as number };
        });
        archive.setFolderOrder(userId(req), body.folder, items);
        return noContent();
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
