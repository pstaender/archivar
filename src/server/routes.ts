import type { BunRequest } from "bun";
import { type AppConfig, type DocumentUpdate, type EditSettings, LIBRARY_SORTS, type LibraryItemRef, type LibrarySort, type Rotation, type StackCreate, type StackUpdate } from "../shared/types";
import { type BatchOptions, duplicateNote, type JobCreate } from "../shared/jobs";
import { isOcrLanguage } from "../shared/languages";
import { type ImagePresetInput, normalizePresetName, normalizePresetSteps } from "../shared/presets";
import { normalizePdfQuality } from "../shared/settings";
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

/** Scripts may leave a switch out; it then follows the user's settings. */
function formFlag(value: FormDataEntryValue | null, fallback: boolean): boolean {
  return typeof value === "string" ? value === "true" : fallback;
}

/** ISO 8601 or Unix seconds (as `stat` prints them), so scripts can pass the file's own date as the upload date. */
function parseCreatedAt(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const time = /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value);
  if (!Number.isFinite(time)) throw new HttpError(400, "Invalid createdAt");
  return new Date(time).toISOString();
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
  const pdfQuality = (req: Request, value: unknown) => normalizePdfQuality(value, ctx.users.settings(userId(req)).pdfImageQuality);

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
          autoCropAvailable: ctx.archive.autoCropAvailable(),
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
        const createdAt = parseCreatedAt(form.get("createdAt"));
        const jobItemValue = form.get("jobItemId");
        const jobItem = typeof jobItemValue === "string" && jobItemValue ? ctx.jobs.item(userId(req), parseId(jobItemValue)) : null;
        const tracked = jobItem?.kind === "import" && jobItem.status === "pending" ? jobItem : null;
        if (tracked) ctx.jobs.updateItem(tracked.id, { status: "running" });
        const settings = ctx.users.settings(userId(req));
        const preset = settings.importPresetId === null ? null : ctx.presets.get(userId(req), settings.importPresetId);
        const docs = await archive.upload(userId(req), files, {
          folders: [...new Set([...parseFolderList(form.get("folders")), ...settings.importFolders])],
          stackId: typeof stackId === "string" && stackId ? parseId(stackId) : undefined,
          runOcr: formFlag(form.get("ocr"), settings.autoOcr),
          ocrAllText: formFlag(form.get("ocrAllText"), settings.ocrAllText),
          preset: preset?.steps,
          ocrLanguages: settings.importOcrLanguages,
          createdAt,
        }).catch((error: unknown) => {
          if (tracked) ctx.jobs.updateItem(tracked.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        });
        const [uploaded] = docs;
        if (tracked && uploaded) {
          ctx.jobs.updateItem(tracked.id, {
            status: "done",
            documentId: uploaded.id,
            ocr: uploaded.ocrStatus === "pending",
            note: uploaded.duplicates.length ? duplicateNote(uploaded.duplicates) : undefined,
          });
        }
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

    "/api/documents/:id/duplicate": {
      POST: handle(async (req: Req) => json(await archive.duplicateDocument(userId(req), parseId(req.params.id)), 201)),
    },

    "/api/documents/:id/detach": {
      POST: handle(async (req: Req) => json(await archive.detachDocument(userId(req), parseId(req.params.id)))),
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
        const editSettings = await archive.applyPreset(userId(req), parseId(req.params.id), preset.steps, body.editSettings);
        return json({ editSettings, shapes: preset.steps.shapes ?? null });
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
        const body = await readJson<{ documentIds?: unknown; title?: unknown; quality?: unknown }>(req);
        if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) throw new HttpError(400, "documentIds required");
        const ids = body.documentIds.map((id) => parseId(String(id)));
        const title = typeof body.title === "string" ? body.title : undefined;
        return pdfResponse(await archive.exportCombinedPdf(userId(req), ids, title, pdfQuality(req, body.quality)));
      }),
    },

    "/api/documents/:id/pdf": {
      POST: handle(async (req: Req) => {
        const body = await readJson<{ text?: unknown; quality?: unknown }>(req).catch(() => ({ text: undefined, quality: undefined }));
        const text = typeof body.text === "string" ? body.text : undefined;
        return pdfResponse(await archive.exportPdf(userId(req), parseId(req.params.id), text, pdfQuality(req, body.quality)));
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

    "/api/documents/:id/edited": {
      GET: handle(async (req: Req) => {
        const doc = archive.getDocument(userId(req), parseId(req.params.id));
        return serveFile(ctx.storage.file(await ctx.imaging.editedKey(doc)), "image/jpeg");
      }),
    },

    "/api/documents/:id/vectors": {
      GET: handle((req: Req) => json(archive.getVectors(userId(req), parseId(req.params.id)))),
      PUT: handle(async (req: Req) => {
        const body = await readJson<{ areas?: unknown }>(req);
        return json(await archive.setVectors(userId(req), parseId(req.params.id), body.areas));
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

    "/api/tokens": {
      GET: handle((req: Req) => json(ctx.tokens.list(userId(req)))),
      POST: handle(async (req: Req) => {
        const body = await readJson<{ name?: unknown }>(req);
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
        if (!name) throw new HttpError(400, "Name required");
        return json(ctx.tokens.create(userId(req), name), 201);
      }),
    },

    "/api/tokens/:id": {
      DELETE: handle((req: Req) => {
        if (!ctx.tokens.delete(userId(req), parseId(req.params.id))) throw new HttpError(404, "Token not found");
        return noContent();
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

    "/api/jobs": {
      GET: handle((req: Req) => json(ctx.jobs.list(userId(req)))),
      POST: handle(async (req: Req) => {
        const body = await readJson<JobCreate>(req);
        if (body.kind === "import") {
          if (!Array.isArray(body.files) || body.files.length === 0) throw new HttpError(400, "files required");
          const id = ctx.jobs.create(userId(req), "import", null, body.files.map((name) => ({ name: String(name), documentId: null })));
          return json(ctx.jobs.get(userId(req), id), 201);
        }
        if (body.kind !== "batch") throw new HttpError(400, "Unknown job kind");
        if (!Array.isArray(body.documentIds) || body.documentIds.length === 0) throw new HttpError(400, "documentIds required");
        const docs = [...new Set(body.documentIds.map((id) => parseId(String(id))))].map((id) => archive.getDocument(userId(req), id));
        const preset = body.presetId ? ctx.presets.get(userId(req), parseId(String(body.presetId))) : null;
        if (body.presetId && !preset) throw new HttpError(404, "Preset not found");
        const languages = Array.isArray(body.languages) && body.languages.length > 0 ? body.languages : null;
        if (languages && !languages.every(isOcrLanguage)) throw new HttpError(400, "Unknown OCR language");
        const options: BatchOptions = {
          preset: preset ? { name: preset.name, steps: preset.steps } : null,
          ocr: body.ocr === true,
          languages,
          allText: body.allText === true,
        };
        if (!options.preset && !options.ocr) throw new HttpError(400, "Nichts zu tun");
        const items = docs.map((doc) => ({ name: doc.title.trim() || doc.originalName, documentId: doc.id }));
        const id = ctx.jobs.create(userId(req), "batch", options, items);
        ctx.jobQueue.start();
        return json(ctx.jobs.get(userId(req), id), 201);
      }),
    },

    "/api/jobs/:id": {
      DELETE: handle((req: Req) => {
        const job = ctx.jobs.get(userId(req), parseId(req.params.id));
        if (!job) throw new HttpError(404, "Job not found");
        if (job.active) throw new HttpError(409, "Der Auftrag läuft noch");
        ctx.jobs.delete(userId(req), job.id);
        return noContent();
      }),
    },

    "/api/jobs/:id/items/:itemId": {
      // The client reports uploads that never reached the server.
      PATCH: handle(async (req: Req) => {
        const body = await readJson<{ error?: unknown }>(req);
        const item = ctx.jobs.item(userId(req), parseId(req.params.itemId));
        if (!item || item.jobId !== parseId(req.params.id)) throw new HttpError(404, "Job item not found");
        if (item.kind === "import" && item.status === "pending") {
          ctx.jobs.updateItem(item.id, { status: "failed", error: typeof body.error === "string" ? body.error : "Upload fehlgeschlagen" });
        }
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
