import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Jimp } from "../shared/image/jimp";
import type { ArchiveDocument, Folder, LibraryItem, StackWithDocuments } from "../shared/types";
import { makePdf } from "../../test/pdf";
import { makeJpeg, startTestServer, type TestServer, uploadForm } from "../../test/server";

let server: TestServer;

beforeEach(async () => {
  server = await startTestServer();
});

afterEach(async () => {
  await server.close();
});

async function upload(files: { name: string; data: Uint8Array; type?: string }[], fields: Record<string, string> = {}) {
  const res = await server.api("/api/documents", { method: "POST", body: uploadForm(files, fields) });
  expect(res.status).toBe(201);
  return (await res.json()) as ArchiveDocument[];
}

async function uploadImage(name = "scan.jpg", fields: Record<string, string> = {}) {
  const [doc] = await upload([{ name, data: await makeJpeg(), type: "image/jpeg" }], fields);
  return doc!;
}

function patch(path: string, body: unknown) {
  return server.api(path, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function post(path: string, body: unknown) {
  return server.api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

describe("users", () => {
  test("requests act as the default user without login", async () => {
    const res = await server.api("/api/me");
    expect(await res.json()).toEqual({ id: 1, name: "default" });
  });
});

describe("documents", () => {
  test("uploads multiple files and detects their kind", async () => {
    const docs = await upload([
      { name: "photo.jpg", data: await makeJpeg(80, 60), type: "image/jpeg" },
      { name: "letter.pdf", data: makePdf("Rechnung 2026"), type: "application/pdf" },
      { name: "notes.txt", data: new TextEncoder().encode("hello"), type: "text/plain" },
    ]);
    expect(docs.map((d) => d.kind)).toEqual(["image", "pdf", "file"]);
    expect(docs[0]).toMatchObject({ title: "photo", width: 80, height: 60, ocrStatus: "none" });
    expect(docs[1]).toMatchObject({ pageCount: 1, ocrStatus: "done", ocrText: "Rechnung 2026" });
  });

  test("detects the mime type from the extension when none is sent", async () => {
    const [doc] = await upload([{ name: "camera.jpg", data: await makeJpeg() }]);
    expect(doc).toMatchObject({ mimeType: "image/jpeg", kind: "image" });
  });

  test("rejects uploads without files", async () => {
    const res = await server.api("/api/documents", { method: "POST", body: new FormData() });
    expect(res.status).toBe(400);
  });

  test("serves original, preview, processed image and thumbnail", async () => {
    const doc = await uploadImage();
    for (const variant of ["file", "preview", "image", "thumbnail"]) {
      const res = await server.api(`/api/documents/${doc.id}/${variant}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toStartWith("image/jpeg");
    }
  });

  test("renders a PDF thumbnail", async () => {
    const [doc] = await upload([{ name: "a.pdf", data: makePdf("Hi"), type: "application/pdf" }]);
    const res = await server.api(`/api/documents/${doc!.id}/thumbnail`);
    expect(res.status).toBe(200);
  });

  test("returns 404 for unknown documents", async () => {
    expect((await server.api("/api/documents/999")).status).toBe(404);
    expect((await server.api("/api/documents/abc")).status).toBe(400);
  });

  test("saves edit settings and re-renders the processed image", async () => {
    const doc = await uploadImage();
    const res = await patch(`/api/documents/${doc.id}`, {
      title: "  Vertrag  ",
      editSettings: {
        rotation: 90,
        colorMode: "grayscale",
        corners: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0.5, y: 1 },
          { x: 0, y: 1 },
        ],
      },
    });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ArchiveDocument;
    expect(updated.title).toBe("Vertrag");
    expect(updated.editSettings).toMatchObject({ rotation: 90, colorMode: "grayscale", brightness: 0 });
    expect(updated).toMatchObject({ width: 24, height: 64 });

    const image = await Jimp.read(Buffer.from(await (await server.api(`/api/documents/${doc.id}/image`)).arrayBuffer()));
    expect(image.bitmap.width).toBe(24);
    const [r, g, b] = image.bitmap.data;
    expect(Math.abs(r! - g!)).toBeLessThan(3);
    expect(Math.abs(g! - b!)).toBeLessThan(3);
  });

  test("merges partial edit settings", async () => {
    const doc = await uploadImage();
    await patch(`/api/documents/${doc.id}`, { editSettings: { brightness: 0.3 } });
    const res = await patch(`/api/documents/${doc.id}`, { editSettings: { contrast: 0.2 } });
    expect(((await res.json()) as ArchiveDocument).editSettings).toMatchObject({ brightness: 0.3, contrast: 0.2 });
  });

  test("refuses edit settings for non-image documents", async () => {
    const [doc] = await upload([{ name: "a.txt", data: new TextEncoder().encode("x"), type: "text/plain" }]);
    expect((await patch(`/api/documents/${doc!.id}`, { editSettings: { brightness: 1 } })).status).toBe(400);
  });

  test("rejects invalid JSON", async () => {
    const doc = await uploadImage();
    const res = await server.api(`/api/documents/${doc.id}`, { method: "PATCH", body: "{nope" });
    expect(res.status).toBe(400);
  });

  test("deletes a document with its files", async () => {
    const doc = await uploadImage();
    expect((await server.api(`/api/documents/${doc.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await server.api(`/api/documents/${doc.id}`)).status).toBe(404);
    expect((await server.api(`/api/documents/${doc.id}/thumbnail`)).status).toBe(404);
  });
});

describe("ocr", () => {
  test("runs OCR in the background and stores the result", async () => {
    const doc = await uploadImage();
    const res = await server.api(`/api/documents/${doc.id}/ocr`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(((await res.json()) as ArchiveDocument).ocrStatus).toBe("pending");
    await server.ctx.ocr.idle();
    const done = (await (await server.api(`/api/documents/${doc.id}`)).json()) as ArchiveDocument;
    expect(done).toMatchObject({ ocrStatus: "done", ocrText: "Hallo Welt", ocrConfidence: 91, ocrError: null });
  });

  test("drops probable noise unless all text parts are requested", async () => {
    server.ocr.result = {
      text: "Rechnung\n\n=a nn - LL",
      confidence: 70,
      paragraphs: [
        [{ confidence: 95, words: [{ text: "Rechnung", confidence: 95 }] }],
        [{ confidence: 40, words: ["=a", "nn", "-", "LL"].map((text) => ({ text, confidence: 40 })) }],
      ],
    };
    const doc = await uploadImage();
    await server.api(`/api/documents/${doc.id}/ocr`, { method: "POST" });
    await server.ctx.ocr.idle();
    expect(server.ctx.documents.getById(doc.id)).toMatchObject({ ocrText: "Rechnung", ocrRemoved: 1 });

    await post(`/api/documents/${doc.id}/ocr`, { allText: true });
    await server.ctx.ocr.idle();
    expect(server.ctx.documents.getById(doc.id)).toMatchObject({ ocrText: "Rechnung\n\n=a nn - LL", ocrRemoved: 0 });
  });

  test("uploads can request all text parts", async () => {
    server.ocr.result = {
      text: "x\n\n~~",
      confidence: 50,
      paragraphs: [[{ confidence: 10, words: [{ text: "~~", confidence: 10 }] }]],
    };
    const doc = await uploadImage("x.jpg", { ocr: "true", ocrAllText: "true" });
    await server.ctx.ocr.idle();
    expect(server.ctx.documents.getById(doc.id)).toMatchObject({ ocrText: "x\n\n~~", ocrRemoved: 0 });
  });

  test("can run OCR directly after upload", async () => {
    const doc = await uploadImage("x.jpg", { ocr: "true" });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(1);
    expect(server.ctx.documents.getById(doc.id)?.ocrStatus).toBe("done");
  });

  test("records OCR failures", async () => {
    server.ocr.error = new Error("engine exploded");
    const doc = await uploadImage();
    await server.api(`/api/documents/${doc.id}/ocr`, { method: "POST" });
    await server.ctx.ocr.idle();
    expect(server.ctx.documents.getById(doc.id)).toMatchObject({ ocrStatus: "failed", ocrError: "engine exploded" });
  });

  test("OCRs every page of a PDF", async () => {
    const [doc] = await upload([{ name: "a.pdf", data: makePdf("Seite"), type: "application/pdf" }]);
    await server.api(`/api/documents/${doc!.id}/ocr`, { method: "POST" });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(1);
  });

  test("OCR text can be corrected manually", async () => {
    const doc = await uploadImage();
    const res = await patch(`/api/documents/${doc.id}`, { ocrText: "korrigiert" });
    expect(((await res.json()) as ArchiveDocument).ocrText).toBe("korrigiert");
  });

  test("rejects OCR for plain files", async () => {
    const [doc] = await upload([{ name: "a.txt", data: new TextEncoder().encode("x"), type: "text/plain" }]);
    expect((await server.api(`/api/documents/${doc!.id}/ocr`, { method: "POST" })).status).toBe(400);
  });
});

describe("dewarp", () => {
  test("reports whether the model is available", async () => {
    expect(await (await server.api("/api/config")).json()).toEqual({ dewarpAvailable: true });
    server.dewarp.isAvailable = false;
    expect(await (await server.api("/api/config")).json()).toEqual({ dewarpAvailable: false });
  });

  test("predicts a grid on the rotated original", async () => {
    const doc = await uploadImage();
    const res = await post(`/api/documents/${doc.id}/dewarp`, { rotation: 90 });
    expect(res.status).toBe(200);
    const grid = (await res.json()) as { rotation: number; columns: number; rows: number; points: number[] };
    expect(grid).toMatchObject({ rotation: 90, columns: 31, rows: 45 });
    expect(grid.points).toHaveLength(2790);
    expect(server.dewarp.inputs[0]).toMatchObject({ width: 48, height: 64 });
  });

  test("saved grids are applied to the processed image", async () => {
    const doc = await uploadImage();
    const grid = await (await post(`/api/documents/${doc.id}/dewarp`, {})).json();
    const res = await patch(`/api/documents/${doc.id}`, { editSettings: { dewarp: grid } });
    const updated = (await res.json()) as ArchiveDocument;
    expect(updated.editSettings.dewarp?.rows).toBe(45);
    expect(updated).toMatchObject({ width: 64, height: 48 });
  });

  test("rejects documents that are not images", async () => {
    const [doc] = await upload([{ name: "a.pdf", data: makePdf("x"), type: "application/pdf" }]);
    expect((await post(`/api/documents/${doc!.id}/dewarp`, {})).status).toBe(400);
  });

  test("returns 503 without a model", async () => {
    server.dewarp.isAvailable = false;
    const doc = await uploadImage();
    expect((await post(`/api/documents/${doc.id}/dewarp`, {})).status).toBe(503);
  });
});

describe("automatic black and white", () => {
  test("suggests variants with the best guess first", async () => {
    const doc = await uploadImage();
    const res = await post(`/api/documents/${doc.id}/auto-bw`, { editSettings: { rotation: 90 } });
    expect(res.status).toBe(200);
    const variants = (await res.json()) as { brightness: number; contrast: number; bwThreshold: number }[];
    expect(variants.length).toBeGreaterThan(0);
    expect(variants[0]).toEqual({ brightness: expect.any(Number), contrast: expect.any(Number), bwThreshold: expect.any(Number) });
    expect(server.ctx.documents.getById(doc.id)?.editSettings.colorMode).toBe("color");
  });

  test("rejects documents that are not images", async () => {
    const [doc] = await upload([{ name: "a.pdf", data: makePdf("x"), type: "application/pdf" }]);
    expect((await post(`/api/documents/${doc!.id}/auto-bw`, {})).status).toBe(400);
  });

  test("uploads with OCR are dewarped and turned black and white", async () => {
    const doc = await uploadImage("x.jpg", { ocr: "true" });
    expect(doc.editSettings.colorMode).toBe("bw");
    expect(doc.editSettings.dewarp?.rows).toBe(45);
    expect(server.dewarp.inputs).toHaveLength(1);
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(1);
  });

  test("without a model uploads with OCR are only turned black and white", async () => {
    server.dewarp.isAvailable = false;
    const doc = await uploadImage("x.jpg", { ocr: "true" });
    expect(doc.editSettings).toMatchObject({ colorMode: "bw", dewarp: null });
  });

  test("uploads without OCR stay untouched", async () => {
    const doc = await uploadImage();
    expect(doc.editSettings.colorMode).toBe("color");
    expect(server.dewarp.inputs).toHaveLength(0);
  });
});

describe("stacks", () => {
  test("creates a stack and hides its documents from the library root", async () => {
    const a = await uploadImage("a.jpg");
    const b = await uploadImage("b.jpg");
    const c = await uploadImage("c.jpg");
    const res = await post("/api/stacks", { title: "Steuer", documentIds: [b.id, a.id] });
    expect(res.status).toBe(201);
    const stack = (await res.json()) as StackWithDocuments;
    expect(stack.title).toBe("Steuer");
    expect(stack.documents.map((d) => d.id)).toEqual([b.id, a.id]);

    const library = (await (await server.api("/api/library")).json()) as LibraryItem[];
    expect(library).toHaveLength(2);
    expect(library.find((i) => i.type === "document")?.type === "document" && c.id).toBe(c.id);
  });

  test("defaults the stack title to the first document", async () => {
    const a = await uploadImage("Rechnung.jpg");
    const stack = (await (await post("/api/stacks", { documentIds: [a.id] })).json()) as StackWithDocuments;
    expect(stack.title).toBe("Rechnung");
  });

  test("reorders, removes and adds documents", async () => {
    const [a, b, c] = [await uploadImage(), await uploadImage(), await uploadImage()];
    const stack = (await (await post("/api/stacks", { documentIds: [a.id, b.id] })).json()) as StackWithDocuments;

    const reordered = (await (await patch(`/api/stacks/${stack.id}`, { documentIds: [b.id, a.id] })).json()) as StackWithDocuments;
    expect(reordered.documentIds).toEqual([b.id, a.id]);

    const added = (await (await post(`/api/stacks/${stack.id}/documents`, { documentIds: [c.id] })).json()) as StackWithDocuments;
    expect(added.documentIds).toEqual([b.id, a.id, c.id]);

    const removed = (await (await patch(`/api/stacks/${stack.id}`, { documentIds: [c.id] })).json()) as StackWithDocuments;
    expect(removed.documentIds).toEqual([c.id]);
    expect(server.ctx.documents.getById(a.id)?.stackId).toBeNull();
  });

  test("removing all documents deletes the stack", async () => {
    const a = await uploadImage();
    const stack = (await (await post("/api/stacks", { documentIds: [a.id] })).json()) as StackWithDocuments;
    expect((await patch(`/api/stacks/${stack.id}`, { documentIds: [] })).status).toBe(204);
    expect((await server.api(`/api/stacks/${stack.id}`)).status).toBe(404);
  });

  test("moving documents into another stack removes the emptied stack", async () => {
    const [a, b] = [await uploadImage(), await uploadImage()];
    const first = (await (await post("/api/stacks", { documentIds: [a.id] })).json()) as StackWithDocuments;
    await post("/api/stacks", { documentIds: [b.id, a.id] });
    expect((await server.api(`/api/stacks/${first.id}`)).status).toBe(404);
  });

  test("uploading into a stack appends the documents", async () => {
    const a = await uploadImage();
    const stack = (await (await post("/api/stacks", { documentIds: [a.id] })).json()) as StackWithDocuments;
    const b = await uploadImage("b.jpg", { stackId: String(stack.id) });
    const loaded = (await (await server.api(`/api/stacks/${stack.id}`)).json()) as StackWithDocuments;
    expect(loaded.documentIds).toEqual([a.id, b.id]);
  });

  test("deleting a stack keeps its documents", async () => {
    const a = await uploadImage();
    const stack = (await (await post("/api/stacks", { documentIds: [a.id] })).json()) as StackWithDocuments;
    expect((await server.api(`/api/stacks/${stack.id}`, { method: "DELETE" })).status).toBe(204);
    expect(server.ctx.documents.getById(a.id)?.stackId).toBeNull();
  });

  test("rejects unknown documents", async () => {
    expect((await post("/api/stacks", { documentIds: [42] })).status).toBe(400);
    expect((await post("/api/stacks", { documentIds: [] })).status).toBe(400);
  });
});

describe("folders", () => {
  test("assigns hierarchical folders and filters the library", async () => {
    const a = await uploadImage("a.jpg", { folders: JSON.stringify(["wichtig/2026"]) });
    const b = await uploadImage("b.jpg");
    await patch(`/api/documents/${b.id}`, { folders: ["privat", " wichtig "] });

    const folders = (await (await server.api("/api/folders")).json()) as Folder[];
    expect(folders.map((f) => f.path)).toEqual(["privat", "wichtig", "wichtig/2026"]);

    const ids = async (query: string) =>
      ((await (await server.api(`/api/library?${query}`)).json()) as LibraryItem[]).map((i) =>
        i.type === "document" ? i.document.id : -i.stack.id,
      );
    expect(await ids("folder=wichtig")).toEqual([b.id, a.id]);
    expect(await ids("folder=wichtig/2026")).toEqual([a.id]);
    expect(await ids("folder=wicht")).toEqual([]);
  });

  test("stacks can carry folders", async () => {
    const a = await uploadImage();
    const stack = (await (await post("/api/stacks", { documentIds: [a.id], folders: ["archiv"] })).json()) as StackWithDocuments;
    expect(stack.folders).toEqual(["archiv"]);
    const library = (await (await server.api("/api/library?folder=archiv")).json()) as LibraryItem[];
    expect(library).toHaveLength(1);
    expect(library[0]!.type).toBe("stack");
  });

  test("stacks are found through the folders of their documents", async () => {
    const a = await uploadImage("a.jpg", { folders: JSON.stringify(["steuer"]) });
    await post("/api/stacks", { documentIds: [a.id] });
    const library = (await (await server.api("/api/library?folder=steuer")).json()) as LibraryItem[];
    expect(library.map((i) => i.type)).toEqual(["stack"]);
  });

  test("renames a folder including its children", async () => {
    const a = await uploadImage("a.jpg", { folders: JSON.stringify(["alt/2025"]) });
    const folders = (await (await post("/api/folders", { path: "alt" })).json()) as Folder;
    const res = await patch(`/api/folders/${folders.id}`, { path: "neu" });
    expect(((await res.json()) as Folder[]).map((f) => f.path)).toEqual(["neu", "neu/2025"]);
    expect(server.ctx.documents.getById(a.id)?.folders).toEqual(["neu/2025"]);
  });

  test("renaming onto an existing folder merges them", async () => {
    const a = await uploadImage("a.jpg", { folders: JSON.stringify(["x"]) });
    const b = await uploadImage("b.jpg", { folders: JSON.stringify(["y"]) });
    const list = (await (await server.api("/api/folders")).json()) as Folder[];
    const x = list.find((f) => f.path === "x")!;
    await patch(`/api/folders/${x.id}`, { path: "y" });
    expect(server.ctx.documents.getById(a.id)?.folders).toEqual(["y"]);
    expect(server.ctx.documents.getById(b.id)?.folders).toEqual(["y"]);
  });

  test("deleting a folder removes its children and assignments", async () => {
    const a = await uploadImage("a.jpg", { folders: JSON.stringify(["wichtig/2026", "privat"]) });
    const list = (await (await server.api("/api/folders")).json()) as Folder[];
    const wichtig = (await (await post("/api/folders", { path: "wichtig" })).json()) as Folder;
    expect(list.length).toBe(2);
    expect((await server.api(`/api/folders/${wichtig.id}`, { method: "DELETE" })).status).toBe(204);
    expect(server.ctx.documents.getById(a.id)?.folders).toEqual(["privat"]);
  });

  test("rejects empty folder names", async () => {
    expect((await post("/api/folders", { path: " / " })).status).toBe(400);
  });
});

describe("search", () => {
  test("finds documents and stacks by title and OCR text", async () => {
    const a = await uploadImage("Mietvertrag.jpg");
    const b = await uploadImage("other.jpg");
    await patch(`/api/documents/${b.id}`, { ocrText: "Kontoauszug Sparkasse" });
    const c = await uploadImage("stacked.jpg");
    await patch(`/api/documents/${c.id}`, { ocrText: "Sparkasse Jahresbericht" });
    const stack = (await (await post("/api/stacks", { title: "Bank", documentIds: [c.id] })).json()) as StackWithDocuments;

    const find = async (q: string) =>
      ((await (await server.api(`/api/library?q=${encodeURIComponent(q)}`)).json()) as LibraryItem[]).map((i) =>
        i.type === "document" ? `d${i.document.id}` : `s${i.stack.id}`,
      );
    expect(await find("miet")).toEqual([`d${a.id}`]);
    expect((await find("sparkasse")).sort()).toEqual([`d${b.id}`, `s${stack.id}`].sort());
    expect(await find("100%")).toEqual([]);
  });
});

test("unknown API routes return JSON 404", async () => {
  const res = await server.api("/api/nope");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Not found" });
});
