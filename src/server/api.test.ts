import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createImage, Jimp } from "../shared/image/jimp";
import { PREVIEW_SIZE } from "../shared/preview";
import type { Job } from "../shared/jobs";
import type { ImagePreset } from "../shared/presets";
import type { ApiToken, CreatedApiToken } from "../shared/tokens";
import type { ArchiveDocument, EditSettings, Folder, LibraryItem, Quad, StackWithDocuments, UploadedDocument } from "../shared/types";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { makePdf } from "../../test/pdf";
import { OCR_TIMEOUT_MESSAGE } from "./services/ocr";
import { renderPdfPage } from "./services/pdf";
import { derivedKeys } from "./storage";
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
  return (await res.json()) as UploadedDocument[];
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
  test("uploads can pass the file's creation date as the upload date", async () => {
    expect((await uploadImage("a.jpg", { createdAt: "2019-05-04T10:20:30Z" })).createdAt).toBe("2019-05-04T10:20:30.000Z");
    expect((await uploadImage("b.jpg", { createdAt: "1557000000" })).createdAt).toBe("2019-05-04T20:00:00.000Z");
    expect(Date.parse((await uploadImage("c.jpg")).createdAt)).toBeGreaterThan(Date.now() - 60_000);
    const res = await server.api("/api/documents", { method: "POST", body: uploadForm([{ name: "d.jpg", data: await makeJpeg(), type: "image/jpeg" }], { createdAt: "gestern" }) });
    expect(res.status).toBe(400);
  });

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

  test("stores the SHA-256 of uploads and names earlier documents with the same content", async () => {
    const data = await makeJpeg();
    const [first] = await upload([{ name: "scan.jpg", data, type: "image/jpeg" }]);
    expect(first!.duplicates).toEqual([]);
    await patch(`/api/documents/${first!.id}`, { title: "Rechnung" });
    const [second, other] = await upload([
      { name: "scan-kopie.jpg", data, type: "image/jpeg" },
      { name: "anders.jpg", data: await makeJpeg(10, 10), type: "image/jpeg" },
    ]);
    expect(second!.duplicates).toEqual([{ id: first!.id, title: "Rechnung" }]);
    expect(other!.duplicates).toEqual([]);
    expect(second!.id).not.toBe(first!.id);
    const row = server.ctx.db.query("SELECT sha256 FROM documents WHERE id = ?").get(first!.id) as { sha256: string };
    expect(row.sha256).toBe(new Bun.CryptoHasher("sha256").update(data).digest("hex"));
  });

  test("records the SHA-256 of files stored before hashes were kept", async () => {
    const doc = await uploadImage();
    server.ctx.db.query("UPDATE documents SET sha256 = NULL").run();
    expect(await server.ctx.archive.hashMissingFiles()).toBe(1);
    expect(await server.ctx.archive.hashMissingFiles()).toBe(0);
    const [copy] = await upload([{ name: "x.jpg", data: await makeJpeg(), type: "image/jpeg" }]);
    expect(copy!.duplicates.map((d) => d.id)).toEqual([doc.id]);
  });

  test("detects the mime type from the extension when none is sent", async () => {
    const [doc] = await upload([{ name: "camera.jpg", data: await makeJpeg() }]);
    expect(doc).toMatchObject({ mimeType: "image/jpeg", kind: "image" });
  });

  test("converts other image formats with ImageMagick and runs OCR on them", async () => {
    const [doc] = await upload([{ name: "foto.webp", data: await makeJpeg(80, 60), type: "image/webp" }], { ocr: "true" });
    expect(doc).toMatchObject({ mimeType: "image/webp", kind: "image", width: 80, height: 60 });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(1);
    expect((await server.api(`/api/documents/${doc!.id}/file`)).headers.get("content-type")).toStartWith("image/webp");

    const calls = server.converter.calls.length;
    await patch(`/api/documents/${doc!.id}`, { editSettings: { rotation: 90 } });
    expect(server.converter.calls.length).toBe(calls);
  });

  test("keeps formats ImageMagick cannot read as plain files", async () => {
    const [doc] = await upload([{ name: "foto.heic", data: new Uint8Array([1, 2, 3]) }]);
    expect(doc).toMatchObject({ mimeType: "image/heic", kind: "file" });
    expect(server.converter.calls).toEqual([]);
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

  test("caps the editor preview at the preview size and recreates it when missing", async () => {
    const [doc] = await upload([{ name: "breit.jpg", data: await makeJpeg(PREVIEW_SIZE + 400, 40) }]);
    const previewSize = async () => {
      const res = await server.api(`/api/documents/${doc!.id}/preview`);
      const { width, height } = (await Jimp.read(Buffer.from(await res.arrayBuffer()))).bitmap;
      return [width, height];
    };
    expect(await previewSize()).toEqual([PREVIEW_SIZE, 35]);

    await server.ctx.storage.delete(derivedKeys.preview(doc!.id));
    expect(await previewSize()).toEqual([PREVIEW_SIZE, 35]);
  });

  test("removes editor previews of other sizes", async () => {
    const doc = await uploadImage();
    const { storage, imaging } = server.ctx;
    await storage.write(`derived/${doc.id}/preview.jpg`, new Uint8Array([1]));
    await storage.write(`derived/${doc.id}/preview-2048.jpg`, new Uint8Array([1]));

    expect(await imaging.removeStalePreviews()).toBe(2);
    expect(await storage.list(`derived/${doc.id}/*`)).toEqual(
      expect.arrayContaining([derivedKeys.preview(doc.id), derivedKeys.processed(doc.id), derivedKeys.thumbnail(doc.id)]),
    );
    expect(await storage.exists(`derived/${doc.id}/preview.jpg`)).toBe(false);
    expect(await storage.exists(`derived/${doc.id}/preview-2048.jpg`)).toBe(false);
    expect(await imaging.removeStalePreviews()).toBe(0);
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

  test("never gives the id of a deleted document out again", async () => {
    const doc = await uploadImage();
    await server.api(`/api/documents/${doc.id}`, { method: "DELETE" });
    expect((await uploadImage()).id).toBe(doc.id + 1);
  });

  test("deletes a document with its files", async () => {
    const doc = await uploadImage();
    expect((await server.api(`/api/documents/${doc.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await server.api(`/api/documents/${doc.id}`)).status).toBe(404);
    expect((await server.api(`/api/documents/${doc.id}/thumbnail`)).status).toBe(404);
  });
});

describe("ocr", () => {
  const getDocument = async (id: number) => (await (await server.api(`/api/documents/${id}`)).json()) as ArchiveDocument;

  test("gives up on a page that takes too long and keeps processing the queue", async () => {
    await server.close();
    server = await startTestServer({ ocrPageTimeoutMs: 30 });
    const stuck = await uploadImage("haengt.jpg");
    const next = await uploadImage("danach.jpg");
    server.ocr.hang = true;
    await post(`/api/documents/${stuck.id}/ocr`, {});
    await server.ctx.ocr.idle();
    expect(await getDocument(stuck.id)).toMatchObject({ ocrStatus: "failed", ocrError: OCR_TIMEOUT_MESSAGE });
    expect(server.ocr.terminations).toBe(1);

    server.ocr.hang = false;
    await post(`/api/documents/${next.id}/ocr`, {});
    await server.ctx.ocr.idle();
    expect(await getDocument(next.id)).toMatchObject({ ocrStatus: "done", ocrText: "Hallo Welt" });
  });

  test("resumes OCR that a previous server process left unfinished", async () => {
    const running = await uploadImage("laufend.jpg");
    const pending = await uploadImage("wartend.jpg");
    const done = await uploadImage("fertig.jpg");
    server.ctx.documents.setOcrResult(running.id, { status: "running" });
    server.ctx.documents.setOcrResult(pending.id, { status: "pending" });
    server.ctx.documents.setOcrResult(done.id, { status: "done", text: "alt" });

    expect(server.ctx.ocr.resume()).toBe(2);
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(2);
    expect((await getDocument(running.id)).ocrStatus).toBe("done");
    expect((await getDocument(pending.id)).ocrStatus).toBe("done");
    expect((await getDocument(done.id)).ocrText).toBe("alt");
  });

  test("runs OCR in the background and stores the result", async () => {
    const doc = await uploadImage();
    const res = await server.api(`/api/documents/${doc.id}/ocr`, { method: "POST" });
    expect(res.status).toBe(202);
    expect(((await res.json()) as ArchiveDocument).ocrStatus).toBe("pending");
    await server.ctx.ocr.idle();
    const done = (await (await server.api(`/api/documents/${doc.id}`)).json()) as ArchiveDocument;
    expect(done).toMatchObject({ ocrStatus: "done", ocrText: "Hallo Welt", ocrConfidence: 91, ocrError: null });
  });

  test("detects the language of the recognized text and recognizes again in a chosen language", async () => {
    server.ocr.result = { text: "Sehr geehrte Damen und Herren, hiermit bestätigen wir den Eingang Ihrer Unterlagen.", confidence: 90 };
    const doc = await uploadImage();
    await post(`/api/documents/${doc.id}/ocr`, {});
    await server.ctx.ocr.idle();
    expect(await getDocument(doc.id)).toMatchObject({ ocrLanguage: "deu", ocrLanguages: null });

    server.ocr.result = { text: "Madame, Monsieur, nous accusons réception de vos documents et vous remercions.", confidence: 85 };
    const queued = (await (await post(`/api/documents/${doc.id}/ocr`, { languages: ["fra"] })).json()) as ArchiveDocument;
    expect(queued.ocrLanguages).toEqual(["fra"]);
    await server.ctx.ocr.idle();
    expect(await getDocument(doc.id)).toMatchObject({ ocrLanguage: "fra", ocrLanguages: ["fra"] });

    await post(`/api/documents/${doc.id}/ocr`, {});
    await server.ctx.ocr.idle();
    await post(`/api/documents/${doc.id}/ocr`, { languages: null });
    await server.ctx.ocr.idle();
    expect(server.ocr.recognizedLanguages).toEqual([undefined, ["fra"], ["fra"], undefined]);
    expect((await getDocument(doc.id)).ocrLanguages).toBeNull();
  });

  test("detects the language of texts stored before languages were detected", async () => {
    const doc = await uploadImage();
    server.ctx.documents.setOcrResult(doc.id, { status: "done", text: "Madame, Monsieur, nous accusons réception de vos documents." });
    server.ctx.documents.setOcrLanguage(doc.id, null);
    const unclear = await uploadImage();
    server.ctx.documents.setOcrResult(unclear.id, { status: "done", text: "12 3" });

    expect(server.ctx.archive.detectMissingLanguages()).toBe(1);
    expect((await getDocument(doc.id)).ocrLanguage).toBe("fra");
    expect((await getDocument(unclear.id)).ocrLanguage).toBeNull();
  });

  test("refuses unknown OCR languages and detects the language of edited text", async () => {
    const doc = await uploadImage();
    expect((await post(`/api/documents/${doc.id}/ocr`, { languages: ["klingonisch"] })).status).toBe(400);
    expect((await post(`/api/documents/${doc.id}/ocr`, { languages: [] })).status).toBe(400);
    expect((await post(`/api/documents/${doc.id}/ocr`, { languages: "fra" })).status).toBe(400);

    const edited = (await (await patch(`/api/documents/${doc.id}`, { ocrText: "Dear Sir or Madam, we hereby confirm that we have received your documents." })).json()) as ArchiveDocument;
    expect(edited.ocrLanguage).toBe("eng");
    expect(((await (await server.api("/api/config")).json()) as { ocrLanguages: string[] }).ocrLanguages).toEqual(["deu", "eng"]);
  });

  test("remembers whether the last run kept all text parts", async () => {
    const doc = await uploadImage();
    await post(`/api/documents/${doc.id}/ocr`, { allText: true });
    await server.ctx.ocr.idle();
    expect((await getDocument(doc.id)).ocrAllText).toBe(true);
    await post(`/api/documents/${doc.id}/ocr`, { allText: false });
    await server.ctx.ocr.idle();
    expect((await getDocument(doc.id)).ocrAllText).toBe(false);
  });

  test("reduces high-resolution scans to A4 at 300 DPI for recognition and keeps the line positions", async () => {
    const [scan] = await upload([{ name: "scan.jpg", data: await makeJpeg(4000, 5000), type: "image/jpeg" }]);
    server.ocr.result = {
      text: "Zeile",
      confidence: 90,
      paragraphs: [[{ confidence: 95, bbox: { x0: 351, y0: 702, x1: 1404, y1: 878 }, words: [{ text: "Zeile", confidence: 95 }] }]],
    };
    await post(`/api/documents/${scan!.id}/ocr`, {});
    await server.ctx.ocr.idle();
    const { width, height } = (await Jimp.read(Buffer.from(server.ocr.images[0]!))).bitmap;
    expect([width, height]).toEqual([2806, 3508]);
    expect(server.ctx.documents.getOcrLayout(1, scan!.id)?.lines[0]?.box).toEqual([351 / 2806, 702 / 3508, 1404 / 2806, 878 / 3508]);

    const small = await uploadImage();
    await post(`/api/documents/${small.id}/ocr`, {});
    await server.ctx.ocr.idle();
    expect((await Jimp.read(Buffer.from(server.ocr.images[1]!))).bitmap).toMatchObject({ width: 64, height: 48 });
  }, 30_000);

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

describe("PDF export", () => {
  const line = (text: string, [x0, y0, x1, y1]: number[]) => ({
    confidence: 95,
    bbox: { x0: x0!, y0: y0!, x1: x1!, y1: y1! },
    words: text.split(" ").map((word) => ({ text: word, confidence: 95 })),
  });

  async function ocrImage() {
    const [doc] = await upload([{ name: "brief.jpg", data: await makeJpeg(200, 100), type: "image/jpeg" }]);
    server.ocr.result = {
      text: "Rechnung\nBetrag 12 EUR",
      confidence: 95,
      paragraphs: [[line("Rechnung", [20, 10, 120, 30])], [line("Betrag 12 EUR", [20, 60, 180, 80])]],
    };
    await post(`/api/documents/${doc!.id}/ocr`, {});
    await server.ctx.ocr.idle();
    return doc!;
  }

  async function exportPdf(id: number, body: unknown = {}) {
    const res = await post(`/api/documents/${id}/pdf`, body);
    expect(res.status).toBe(200);
    const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const page = await pdf.getPage(1);
    const [, , width, height] = page.view;
    const items = (await page.getTextContent()).items.flatMap((item) => ("str" in item && item.str.trim() ? [item] : []));
    return { res, width: width!, height: height!, items: items.map((i) => ({ text: i.str, x: i.transform[4] as number, y: i.transform[5] as number })) };
  }

  test("puts the recognized text invisibly onto the line positions of the image", async () => {
    const doc = await ocrImage();
    const { res, width, height, items } = await exportPdf(doc.id);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''brief.pdf");
    expect([width, height]).toEqual([842, 421]);
    expect(items.map((i) => i.text)).toEqual(["Rechnung", "Betrag 12 EUR"]);
    expect(items[0]!.x).toBeCloseTo((20 / 200) * 842, 0);
    expect(items[1]!.x).toBeCloseTo((20 / 200) * 842, 0);
    expect(items[0]!.y).toBeGreaterThan(height * 0.6);
    expect(items[1]!.y).toBeLessThan(height * 0.25);
  });

  test("uses edited text on the recognized lines when the line count still matches", async () => {
    const doc = await ocrImage();
    const { items } = await exportPdf(doc.id, { text: "Rechnung Nr. 7\nBetrag 12 €" });
    expect(items.map((i) => i.text)).toEqual(["Rechnung Nr. 7", "Betrag 12 €"]);
    expect(items[0]!.x).toBeCloseTo((20 / 200) * 842, 0);
  });

  test("spreads text over the page when it no longer matches the image or the lines", async () => {
    const doc = await ocrImage();
    const spread = await exportPdf(doc.id, { text: "eins\nzwei\ndrei" });
    expect(spread.items.map((i) => i.text)).toEqual(["eins", "zwei", "drei"]);
    expect(spread.items[0]!.x).toBeCloseTo(0.05 * spread.width, 0);

    await patch(`/api/documents/${doc.id}`, { editSettings: { rotation: 90 } });
    const rotated = await exportPdf(doc.id);
    expect([rotated.width, rotated.height]).toEqual([421, 842]);
    expect(rotated.items.map((i) => i.text)).toEqual(["Rechnung", "Betrag 12 EUR"]);
    expect(rotated.items[0]!.x).toBeCloseTo(0.05 * rotated.width, 0);
  });

  test("replaces characters the PDF font cannot show", async () => {
    const doc = await uploadImage();
    const { items } = await exportPdf(doc.id, { text: "Łódź – Grüße 中" });
    expect(items.map((i) => i.text)).toEqual(["?ódz – Grüße ?"]);
  });

  test("combines images and PDFs of several documents into one PDF in the given order", async () => {
    const first = await ocrImage();
    const [pdfDoc] = await upload([{ name: "anhang.pdf", data: makePdf("Anhang Seite"), type: "application/pdf" }]);
    const second = await uploadImage("zweites.jpg");
    await patch(`/api/documents/${second.id}`, { ocrText: "Zweites Bild" });
    const [file] = await upload([{ name: "notiz.heic", data: new Uint8Array([1, 2, 3]) }]);

    const res = await post("/api/export/pdf", { documentIds: [second.id, pdfDoc!.id, file!.id, first.id], title: "Mappe März" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename*=UTF-8''${encodeURIComponent("Mappe März.pdf")}`);
    const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    expect(pdf.numPages).toBe(3);
    const pageTexts: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const items = (await (await pdf.getPage(i)).getTextContent()).items;
      pageTexts.push(items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " ").trim());
    }
    expect(pageTexts).toEqual(["Zweites Bild", "Anhang Seite", "Rechnung Betrag 12 EUR"]);
  });

  test("refuses a combined PDF without images or PDFs", async () => {
    const [file] = await upload([{ name: "notiz.heic", data: new Uint8Array([1, 2, 3]) }]);
    expect((await post("/api/export/pdf", { documentIds: [file!.id] })).status).toBe(400);
    expect((await post("/api/export/pdf", { documentIds: [] })).status).toBe(400);
    expect((await post("/api/export/pdf", { documentIds: [999] })).status).toBe(404);
  });

  test("exports images without text and refuses other documents", async () => {
    const doc = await uploadImage();
    expect((await exportPdf(doc.id)).items).toEqual([]);
    const [pdf] = await upload([{ name: "a.pdf", data: makePdf("Hi"), type: "application/pdf" }]);
    expect((await post(`/api/documents/${pdf!.id}/pdf`, {})).status).toBe(400);
  });
});

describe("settings", () => {
  const patchSettings = async (body: unknown) => (await patch("/api/settings", body)).json();

  test("stores the user's settings and ignores unknown values", async () => {
    const defaults = { autoOcr: false, ocrAllText: false, pdfImageQuality: "medium", importPresetId: null, importFolders: [], importOcrLanguages: null };
    expect(await (await server.api("/api/settings")).json()).toEqual(defaults);
    expect(await patchSettings({ autoOcr: true, uploadEnhancement: "grayscale" })).toEqual({ ...defaults, autoOcr: true });
    expect(await patchSettings({ pdfImageQuality: "72", ocrAllText: "ja", importPresetId: -3 })).toEqual({ ...defaults, autoOcr: true });
    expect(await patchSettings({ pdfImageQuality: "original", ocrAllText: true })).toMatchObject({ pdfImageQuality: "original", ocrAllText: true });
    expect(await (await server.api("/api/settings")).json()).toEqual({ ...defaults, autoOcr: true, pdfImageQuality: "original", ocrAllText: true });
    expect(await patchSettings({ importOcrLanguages: ["fra", "xx", "fra"] })).toMatchObject({ importOcrLanguages: ["fra"] });
    expect(await patchSettings({ importOcrLanguages: ["xx"] })).toMatchObject({ importOcrLanguages: null });
  });

  test("turns the PDF resolutions stored before into the named qualities", async () => {
    expect(await patchSettings({ pdfImageQuality: "150" })).toMatchObject({ pdfImageQuality: "low" });
    expect(await patchSettings({ pdfImageQuality: "300" })).toMatchObject({ pdfImageQuality: "medium" });
    server.ctx.db.query("UPDATE users SET settings = ?").run(JSON.stringify({ pdfImageQuality: "150" }));
    expect(await (await server.api("/api/settings")).json()).toMatchObject({ pdfImageQuality: "low" });
  });

  const getDocument = async (id: number) => (await (await server.api(`/api/documents/${id}`)).json()) as ArchiveDocument;

  test("recognizes uploads in the import language", async () => {
    await patchSettings({ importOcrLanguages: ["ita"] });
    const doc = await uploadImage("scan.jpg", { ocr: "true" });
    expect(doc.ocrLanguages).toEqual(["ita"]);
    await server.ctx.ocr.idle();
    expect(server.ocr.recognizedLanguages).toEqual([["ita"]]);
  });

  test("recognizes uploads again in the detected language when it is not a default one", async () => {
    const french = "Madame, Monsieur, nous accusons réception de vos documents et vous remercions.";
    server.ocr.result = { text: "Madame, Monsieur, nous accusons r6ception de vos documents et vous remerclons.", confidence: 70 };
    server.ocr.resultsByLanguage = { fra: { text: french, confidence: 88 } };
    const doc = await uploadImage("lettre.jpg", { ocr: "true" });
    await server.ctx.ocr.idle();
    expect(server.ocr.recognizedLanguages).toEqual([undefined, ["fra"]]);
    expect(await getDocument(doc.id)).toMatchObject({ ocrText: french, ocrConfidence: 88, ocrLanguage: "fra", ocrLanguages: ["fra"] });

    server.ocr.resultsByLanguage = { fra: { text: french, confidence: 40 } };
    const worse = await uploadImage("lettre2.jpg", { ocr: "true" });
    await server.ctx.ocr.idle();
    expect(await getDocument(worse.id)).toMatchObject({ ocrConfidence: 70, ocrLanguages: null });

    server.ocr.result = { text: "Sehr geehrte Damen und Herren, hiermit bestätigen wir den Eingang.", confidence: 90 };
    server.ocr.recognizedLanguages = [];
    await uploadImage("brief.jpg", { ocr: "true" });
    await server.ctx.ocr.idle();
    expect(server.ocr.recognizedLanguages).toEqual([undefined]);
  });

  test("every user starts with black and white, auto levels and rotation as import preset, also without OCR", async () => {
    await server.close();
    server = await startTestServer({ importPreset: true });
    server.ocr.orientation = { rotation: 90, confidence: 8 };
    const [preset] = (await (await server.api("/api/presets")).json()) as ImagePreset[];
    expect(preset).toMatchObject({ name: "OCR Optimiert", steps: { autoRotate: true, autoBw: true, autoLevels: true } });
    expect(await (await server.api("/api/settings")).json()).toMatchObject({ importPresetId: preset!.id });

    const doc = await uploadImage();
    expect(doc.editSettings).toMatchObject({ rotation: 90, colorMode: "bw", autoLevels: true });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(0);

    await patchSettings({ importPresetId: null });
    expect((await uploadImage("b.jpg", { ocr: "true" })).editSettings).toMatchObject({ rotation: 0, colorMode: "color" });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(1);
  });

  test("exports grayscale with a threshold as a 1-bit image", async () => {
    const [doc] = await upload([{ name: "scan.jpg", data: await makeJpeg(300, 400, [250, 250, 250]), type: "image/jpeg" }]);
    await patch(`/api/documents/${doc!.id}`, { editSettings: { colorMode: "grayscale", grayThreshold: 128 } });
    const pdf = await PDFDocument.load(await (await post(`/api/documents/${doc!.id}/pdf`, {})).arrayBuffer());
    const image = pdf.context.enumerateIndirectObjects().find(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
    expect((image![1] as PDFRawStream).dict.get(PDFName.of("BitsPerComponent"))!.toString()).toBe("1");
  });

  test("scales images in exported PDFs down to the chosen quality, by default the setting's", async () => {
    const [doc] = await upload([{ name: "scan.jpg", data: await makeJpeg(3000, 4000, [250, 250, 250]), type: "image/jpeg" }]);
    await patch(`/api/documents/${doc!.id}`, { editSettings: { colorMode: "bw" } });
    const imageWidth = async (res: Response) => {
      const pdf = await PDFDocument.load(await res.arrayBuffer());
      const image = pdf.context.enumerateIndirectObjects().find(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"));
      return Number((image![1] as PDFRawStream).dict.get(PDFName.of("Width"))!.toString());
    };
    const width = async (quality?: unknown) => imageWidth(await post(`/api/documents/${doc!.id}/pdf`, { quality }));
    expect([await width("original"), await width("high"), await width("medium"), await width("low")]).toEqual([3000, 3000, 2630, 1316]);
    expect(await width()).toBe(2630);
    await patchSettings({ pdfImageQuality: "low" });
    expect(await width()).toBe(1316);
    expect(await width("nope")).toBe(1316);
    expect(await imageWidth(await post("/api/export/pdf", { documentIds: [doc!.id], quality: "medium" }))).toBe(2630);
  }, 30_000);

  test("compresses color images by the custom level", async () => {
    const noisy = new Uint8ClampedArray(600 * 800 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7919) % 251));
    const [doc] = await upload([{ name: "foto.png", data: new Uint8Array(await createImage(600, 800, noisy).getBuffer("image/png")), type: "image/png" }]);
    const size = async (quality: unknown) => (await (await post(`/api/documents/${doc!.id}/pdf`, { quality })).arrayBuffer()).byteLength;
    expect(await size(0)).toBeLessThan((await size(10)) / 3);
    expect(await size(-5)).toBe(await size(0));
  }, 30_000);
});

describe("dewarp", () => {
  test("reports whether the model is available", async () => {
    const config = { convertibleImageTypes: ["image/webp"], ocrLanguages: ["deu", "eng"] };
    expect(await (await server.api("/api/config")).json()).toEqual({ ...config, dewarpAvailable: true, autoCropAvailable: true });
    server.dewarp.isAvailable = false;
    server.segmenter.isAvailable = false;
    expect(await (await server.api("/api/config")).json()).toEqual({ ...config, dewarpAvailable: false, autoCropAvailable: false });
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

async function pageOnBackground(width: number, height: number, page: { left: number; top: number; right: number; bottom: number }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= page.left * width && x < page.right * width && y >= page.top * height && y < page.bottom * height;
      data.fill(inside ? 240 : 70, (y * width + x) * 4, (y * width + x) * 4 + 3);
      data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return new Uint8Array(await createImage(width, height, data).getBuffer("image/png"));
}

describe("automatic rotation and cropping", () => {
  test("detects the orientation of the original", async () => {
    const doc = await uploadImage();
    server.ocr.orientation = { rotation: 270, confidence: 8 };
    const res = await post(`/api/documents/${doc.id}/orientation`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rotation: 270 });
  });

  test("reports no orientation when tesseract is unsure", async () => {
    const doc = await uploadImage();
    server.ocr.orientation = { rotation: 90, confidence: 0.5 };
    expect(await (await post(`/api/documents/${doc.id}/orientation`, {})).json()).toEqual({ rotation: null });
    server.ocr.orientation = null;
    expect(await (await post(`/api/documents/${doc.id}/orientation`, {})).json()).toEqual({ rotation: null });
  });

  test("finds the page with the segmentation model in the rotated image", async () => {
    const [doc] = await upload([{ name: "page.png", data: await pageOnBackground(400, 300, { left: 0.25, top: 0.2, right: 0.75, bottom: 0.8 }), type: "image/png" }]);
    const data = new Uint8Array(100 * 100);
    for (let y = 20; y < 70; y++) data.fill(255, y * 100 + 10, y * 100 + 90);
    server.segmenter.mask = { width: 100, height: 100, data };
    const res = await post(`/api/documents/${doc!.id}/auto-crop`, { editSettings: { rotation: 90 } });
    expect(res.status).toBe(200);
    const { corners } = (await res.json()) as { corners: { x: number; y: number }[] };
    const input = server.segmenter.inputs.at(-1)!;
    expect([input.width, input.height]).toEqual([300, 400]);
    const expected = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.2 },
      { x: 0.9, y: 0.7 },
      { x: 0.1, y: 0.7 },
    ];
    corners.forEach((corner, i) => {
      expect(corner.x).toBeCloseTo(expected[i]!.x, 1);
      expect(corner.y).toBeCloseTo(expected[i]!.y, 1);
    });
    expect(server.ctx.documents.getById(doc!.id)?.editSettings.corners).toBeNull();
  });

  test("returns no corners when there is no page outline", async () => {
    const doc = await uploadImage();
    expect(await (await post(`/api/documents/${doc.id}/auto-crop`, {})).json()).toEqual({ corners: null });
  });

  test("reports 503 without the segmentation model", async () => {
    const doc = await uploadImage();
    server.segmenter.isAvailable = false;
    expect((await post(`/api/documents/${doc.id}/auto-crop`, {})).status).toBe(503);
  });

  test("rejects documents that are not images", async () => {
    const [doc] = await upload([{ name: "a.pdf", data: makePdf("x"), type: "application/pdf" }]);
    expect((await post(`/api/documents/${doc!.id}/orientation`, {})).status).toBe(400);
    expect((await post(`/api/documents/${doc!.id}/auto-crop`, {})).status).toBe(400);
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
    expect((await post(`/api/documents/${doc!.id}/render`, {})).status).toBe(400);
  });

  test("renders unsaved settings at full resolution without saving them", async () => {
    const [doc] = await upload([{ name: "a.jpg", data: await makeJpeg(80, 60), type: "image/jpeg" }]);
    const res = await post(`/api/documents/${doc!.id}/render`, { editSettings: { rotation: 90, colorMode: "bw" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const image = await Jimp.read(Buffer.from(await res.arrayBuffer()));
    expect(image.bitmap).toMatchObject({ width: 60, height: 80 });
    expect(server.ctx.documents.getById(doc!.id)?.editSettings).toMatchObject({ rotation: 0, colorMode: "color" });
  });

  test("uploads without an import preset stay untouched, also with OCR", async () => {
    const doc = await uploadImage("x.jpg", { ocr: "true" });
    expect(doc.editSettings.colorMode).toBe("color");
    expect(server.dewarp.inputs).toHaveLength(0);
  });
});

describe("image presets", () => {
  const createPreset = async (body: unknown) => {
    const res = await post("/api/presets", body);
    expect(res.status).toBe(201);
    return (await res.json()) as ImagePreset;
  };

  test("stores only valid steps, lists them by name, renames, edits and deletes them", async () => {
    const preset = await createPreset({
      name: "  Beleg ",
      steps: { autoBw: true, brightness: -0.09, colorMode: "bw", denoise: 9, saturation: "viel", corners: [] },
    });
    expect(preset).toMatchObject({ name: "Beleg", steps: { autoBw: true, denoise: 3 } });
    await createPreset({ name: "Aquarell", steps: { saturation: 20 } });
    const list = (await (await server.api("/api/presets")).json()) as ImagePreset[];
    expect(list.map((p) => p.name)).toEqual(["Aquarell", "Beleg", "OCR Optimiert"]);

    const res = await patch(`/api/presets/${preset.id}`, { name: "Kassenbon", steps: { brightness: 0.2 } });
    expect(await res.json()).toMatchObject({ name: "Kassenbon", steps: { brightness: 0.2 } });
    expect((await patch(`/api/presets/${preset.id}`, { name: " " })).status).toBe(400);
    expect((await patch(`/api/presets/${preset.id}`, { steps: {} })).status).toBe(400);

    expect((await server.api(`/api/presets/${preset.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await server.api(`/api/presets/${preset.id}`, { method: "DELETE" })).status).toBe(404);
  });

  test("rejects presets without a name or steps", async () => {
    expect((await post("/api/presets", { name: "", steps: { autoBw: true } })).status).toBe(400);
    expect((await post("/api/presets", { name: "Leer", steps: { foo: 1 } })).status).toBe(400);
  });

  test("applies a preset on top of unsaved settings without saving it", async () => {
    server.ocr.orientation = { rotation: 90, confidence: 8 };
    const doc = await uploadImage();
    const preset = await createPreset({ name: "Scan", steps: { autoRotate: true, autoDewarp: true, brightness: 0.25 } });
    const res = await post(`/api/documents/${doc.id}/apply-preset`, { presetId: preset.id, editSettings: { contrast: 0.5 } });
    const { editSettings } = (await res.json()) as { editSettings: EditSettings };
    expect(editSettings).toMatchObject({ rotation: 90, brightness: 0.25, contrast: 0.5, colorMode: "color" });
    expect(editSettings.dewarp?.rotation).toBe(90);
    expect(server.ctx.documents.getById(doc.id)?.editSettings.rotation).toBe(0);
    expect((await post(`/api/documents/${doc.id}/apply-preset`, { presetId: 999 })).status).toBe(404);
  });

  test("applies a fixed crop and grayscale channels from a preset", async () => {
    const doc = await uploadImage();
    const crop: Quad = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const grayMix = { reds: 120, yellows: 110, greens: -10, cyans: -50, blues: -50, magentas: 120 };
    const preset = await createPreset({ name: "Formular", steps: { crop, colorMode: "grayscale", grayMix } });
    expect(preset.steps).toEqual({ crop, colorMode: "grayscale", grayMix });
    const res = await post(`/api/documents/${doc.id}/apply-preset`, { presetId: preset.id });
    expect(((await res.json()) as { editSettings: EditSettings }).editSettings).toMatchObject({ corners: crop, colorMode: "grayscale", grayMix });
    const saved = (await (await patch(`/api/documents/${doc.id}`, { editSettings: { corners: crop, colorMode: "grayscale", grayMix } })).json()) as ArchiveDocument;
    expect(saved.editSettings.grayMix).toEqual(grayMix);
  });

  test("uploads get the import preset instead of the OCR preparation, and the import folders", async () => {
    const preset = await createPreset({ name: "Grau", steps: { colorMode: "grayscale", contrast: 0.3 } });
    await patch("/api/settings", { importPresetId: preset.id, importFolders: ["eingang/ ", "", "eingang"] });
    expect(await (await server.api("/api/settings")).json()).toMatchObject({ importPresetId: preset.id, importFolders: ["eingang"] });

    const doc = await uploadImage("x.jpg", { ocr: "true", folders: JSON.stringify(["wichtig"]) });
    expect(doc.editSettings).toMatchObject({ colorMode: "grayscale", contrast: 0.3, brightness: 0 });
    expect(doc.folders.sort()).toEqual(["eingang", "wichtig"]);
    const [pdf] = await upload([{ name: "a.pdf", data: makePdf("x"), type: "application/pdf" }]);
    expect(pdf!.folders).toEqual(["eingang"]);
  });

  test("deleting the import preset turns it off in the settings", async () => {
    const preset = await createPreset({ name: "SW", steps: { autoBw: true } });
    await patch("/api/settings", { importPresetId: preset.id });
    await server.api(`/api/presets/${preset.id}`, { method: "DELETE" });
    expect(await (await server.api("/api/settings")).json()).toMatchObject({ importPresetId: null });
    const doc = await uploadImage();
    expect(doc.editSettings.colorMode).toBe("color");
  });
});

describe("jobs", () => {
  const jobs = async () => (await (await server.api("/api/jobs")).json()) as Job[];
  const states = (job: Job | undefined) => job?.items.map((item) => [item.name, item.state, item.error]);

  test("batch jobs apply the preset to images and queue OCR for images and PDFs in the background", async () => {
    const photo = await uploadImage("foto.jpg");
    await patch(`/api/documents/${photo.id}`, { editSettings: { brightness: 0.2, saturation: 30 } });
    const [pdf, note] = await upload([
      { name: "brief.pdf", data: makePdf(""), type: "application/pdf" },
      { name: "notiz.txt", data: new TextEncoder().encode("x"), type: "text/plain" },
    ]);
    const preset = (await (await post("/api/presets", { name: "Grau", steps: { colorMode: "grayscale" } })).json()) as ImagePreset;

    const res = await post("/api/jobs", { kind: "batch", documentIds: [photo.id, pdf!.id, note!.id], presetId: preset.id, ocr: true, languages: ["fra"], allText: true });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Job;
    expect(created).toMatchObject({ kind: "batch", active: true, options: { preset: { name: "Grau" }, ocr: true, languages: ["fra"], allText: true } });

    await server.ctx.jobQueue.idle();
    await server.ctx.ocr.idle();
    const [job] = await jobs();
    expect(states(job)).toEqual([
      ["foto", "done", null],
      ["brief", "done", null],
      ["notiz", "skipped", null],
    ]);
    expect(job!.active).toBe(false);
    expect(created.finishedAt).toBeNull();
    const finishedAt = job!.finishedAt!;
    expect(finishedAt >= job!.createdAt).toBe(true);
    expect(server.ctx.documents.getById(photo.id)).toMatchObject({ editSettings: { colorMode: "grayscale" }, ocrLanguages: ["fra"], ocrAllText: true });
    expect(server.ctx.documents.getById(photo.id)?.editSettings).toMatchObject({ brightness: 0, saturation: 0 });
    expect(server.ctx.documents.getById(pdf!.id)?.editSettings.colorMode).toBe("color");
    expect(server.ocr.recognizedLanguages).toEqual([["fra"], ["fra"]]);

    // Later recognition runs of the document do not change the finished job.
    server.ctx.documents.setOcrResult(photo.id, { status: "running" });
    expect((await jobs())[0]).toMatchObject({ active: false, finishedAt, items: [{ state: "done" }, {}, {}] });
    server.ctx.documents.setOcrResult(photo.id, { status: "failed", error: "kaputt" });
    expect(states((await jobs())[0])?.[0]).toEqual(["foto", "done", null]);
  });

  test("each job keeps the outcome of the text recognition it queued itself", async () => {
    const photo = await uploadImage("foto.jpg");
    const start = async () => {
      const job = (await (await post("/api/jobs", { kind: "batch", documentIds: [photo.id], ocr: true })).json()) as Job;
      await server.ctx.jobQueue.idle();
      return job.id;
    };
    const first = await start();
    await server.ctx.ocr.idle();

    server.ocr.hang = true;
    const second = await start();
    const byId = async (id: number) => (await jobs()).find((job) => job.id === id)!;
    // Waits for its own recognition, while the finished job stays finished.
    expect(await byId(second)).toMatchObject({ active: true, finishedAt: null, items: [{ state: "ocr" }] });
    expect(await byId(first)).toMatchObject({ active: false, items: [{ state: "done" }] });

    server.ctx.documents.setOcrResult(photo.id, { status: "failed", error: "kaputt" });
    expect(states(await byId(second))).toEqual([["foto", "failed", "kaputt"]]);
    expect((await byId(second)).finishedAt).toEqual(expect.any(String));
    expect(states(await byId(first))).toEqual([["foto", "done", null]]);
    // The recognition finishing later does not undo that either.
    server.ocr.release();
    await server.ctx.ocr.idle();
    expect(states(await byId(second))).toEqual([["foto", "failed", "kaputt"]]);
  });

  test("batch jobs need documents of the user and something to do", async () => {
    const photo = await uploadImage();
    expect((await post("/api/jobs", { kind: "batch", documentIds: [photo.id], ocr: false })).status).toBe(400);
    expect((await post("/api/jobs", { kind: "batch", documentIds: [999], ocr: true })).status).toBe(404);
    expect((await post("/api/jobs", { kind: "batch", documentIds: [photo.id], ocr: true, languages: ["xx"] })).status).toBe(400);
    expect((await post("/api/jobs", { kind: "batch", documentIds: [photo.id], presetId: 999, ocr: true })).status).toBe(404);
  });

  test("import jobs follow the uploads of their files", async () => {
    const res = await post("/api/jobs", { kind: "import", files: ["a.jpg", "b.jpg", "c.jpg"] });
    const job = (await res.json()) as Job;
    expect(states(job)).toEqual([
      ["a.jpg", "pending", null],
      ["b.jpg", "pending", null],
      ["c.jpg", "pending", null],
    ]);
    const [a, b] = job.items;
    await uploadImage("vorher.jpg");
    const doc = await uploadImage("a.jpg", { jobItemId: String(a!.id), ocr: "true" });
    await patch(`/api/jobs/${job.id}/items/${b!.id}`, { error: "Netzwerkfehler" });

    const listed = (await jobs())[0]!;
    expect(listed.items[0]).toMatchObject({ state: expect.stringMatching(/ocr|done/), note: "Bereits vorhanden als „vorher“", document: { id: doc.id, title: "a" } });
    expect(states(listed)?.slice(1)).toEqual([
      ["b.jpg", "failed", "Netzwerkfehler"],
      ["c.jpg", "pending", null],
    ]);
    expect(listed.active).toBe(true);
    expect((await server.api(`/api/jobs/${job.id}`, { method: "DELETE" })).status).toBe(409);

    // After a restart, uploads that never arrived are marked as interrupted.
    server.ctx.jobQueue.resume();
    await server.ctx.ocr.idle();
    expect(states((await jobs())[0])?.slice(1)).toEqual([
      ["b.jpg", "failed", "Netzwerkfehler"],
      ["c.jpg", "failed", "Der Upload wurde abgebrochen."],
    ]);
    expect((await jobs())[0]!.finishedAt).toEqual(expect.any(String));
    expect((await server.api(`/api/jobs/${job.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await jobs()).toEqual([]);
  });

  test("batch items of deleted documents fail instead of stopping the job", async () => {
    const a = await uploadImage("a.jpg");
    const b = await uploadImage("b.jpg");
    const preset = (await (await post("/api/presets", { name: "SW", steps: { colorMode: "bw" } })).json()) as ImagePreset;
    const id = server.ctx.jobs.create(1, "batch", { preset: { name: "SW", steps: preset.steps }, ocr: false, languages: null, allText: false }, [
      { name: "a", documentId: a.id },
      { name: "b", documentId: b.id },
    ]);
    await server.api(`/api/documents/${a.id}`, { method: "DELETE" });
    server.ctx.jobQueue.start();
    await server.ctx.jobQueue.idle();
    expect(states(server.ctx.jobs.get(1, id)!)).toEqual([
      ["a", "failed", "Das Dokument wurde gelöscht."],
      ["b", "done", null],
    ]);
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

  test("never gives the id of a deleted stack out again", async () => {
    const stack = (await (await post("/api/stacks", { documentIds: [(await uploadImage()).id] })).json()) as StackWithDocuments;
    await server.api(`/api/stacks/${stack.id}`, { method: "DELETE" });
    const next = (await (await post("/api/stacks", { documentIds: [(await uploadImage()).id] })).json()) as StackWithDocuments;
    expect(next.id).toBe(stack.id + 1);
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

describe("library sorting", () => {
  const titles = async (query: string) =>
    ((await (await server.api(`/api/library${query}`)).json()) as LibraryItem[]).map((item) =>
      item.type === "stack" ? item.stack.title : item.document.title,
    );
  const put = (path: string, body: unknown) =>
    server.api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function setup() {
    const ids: Record<string, number> = {};
    for (const name of ["Banane", "apfel", "Kirsche 10", "Kirsche 9"]) {
      ids[name] = (await uploadImage(`${name}.jpg`, { folders: "obst" })).id;
    }
    await patch(`/api/documents/${ids.Banane}`, { title: "Banane" });
    return ids;
  }

  test("sorts by upload date, change date and name", async () => {
    await setup();
    expect(await titles("?folder=obst")).toEqual(["Banane", "Kirsche 9", "Kirsche 10", "apfel"]);
    expect(await titles("?folder=obst&sort=created-asc")).toEqual(["Banane", "apfel", "Kirsche 10", "Kirsche 9"]);
    expect(await titles("?folder=obst&sort=created-desc")).toEqual(["Kirsche 9", "Kirsche 10", "apfel", "Banane"]);
    expect(await titles("?folder=obst&sort=title-asc")).toEqual(["apfel", "Banane", "Kirsche 9", "Kirsche 10"]);
    expect(await titles("?folder=obst&sort=title-desc")).toEqual(["Kirsche 10", "Kirsche 9", "Banane", "apfel"]);
    expect((await server.api("/api/library?sort=random")).status).toBe(400);
  });

  test("keeps the order arranged in a folder, with new items at the end", async () => {
    const ids = await setup();
    const stack = (await (await post("/api/stacks", { documentIds: [ids["Kirsche 9"]!], title: "Mappe", folders: ["obst"] })).json()) as { id: number };
    const order = [
      { type: "document", id: ids["Kirsche 10"] },
      { type: "stack", id: stack.id },
      { type: "document", id: ids.Banane },
    ];
    expect((await put("/api/folders/order", { folder: "obst", items: order })).status).toBe(204);

    expect(await titles("?folder=obst&sort=custom")).toEqual(["Kirsche 10", "Mappe", "Banane", "apfel"]);
    const later = await uploadImage("Dattel.jpg", { folders: "obst" });
    expect((await titles("?folder=obst&sort=custom")).at(-1)).toBe(later.title);
    expect(await titles("?folder=&sort=custom")).toContain("apfel");

    expect((await put("/api/folders/order", { folder: "obst", items: [{ type: "folder", id: 1 }] })).status).toBe(400);
    expect((await put("/api/folders/order", { items: [] })).status).toBe(400);
  });

  test("keeps the arranged order of a folder that only exists through its sub-folders", async () => {
    const a = await uploadImage("a.jpg", { folders: "privat/wohnung" });
    const b = await uploadImage("b.jpg", { folders: "privat/auto" });
    await put("/api/folders/order", { folder: "privat", items: [{ type: "document", id: a.id }, { type: "document", id: b.id }] });
    expect(await titles("?folder=privat&sort=custom")).toEqual(["a", "b"]);
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

describe("API tokens", () => {
  const createToken = async (name = "Scanner") => {
    const res = await post("/api/tokens", { name });
    expect(res.status).toBe(201);
    return (await res.json()) as CreatedApiToken;
  };

  test("creates a token that is shown once and listed without its secret", async () => {
    const created = await createToken();
    expect(created.token).toStartWith(created.prefix);
    expect(created.token.length).toBeGreaterThan(40);
    const list = (await (await server.api("/api/tokens")).json()) as ApiToken[];
    expect(list).toEqual([{ id: created.id, name: "Scanner", prefix: created.prefix, createdAt: created.createdAt, lastUsedAt: null }]);
    expect(JSON.stringify(list)).not.toContain(created.token);
    expect((await post("/api/tokens", { name: " " })).status).toBe(400);
  });

  test("authenticates requests with a bearer token and records its use", async () => {
    const { id, token } = await createToken();
    const form = uploadForm([{ name: "scan.jpg", data: await makeJpeg(), type: "image/jpeg" }]);
    const res = await server.api("/api/documents", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    expect(res.status).toBe(201);
    const me = await (await server.api("/api/me", { headers: { Authorization: `Bearer ${token}` } })).json();
    expect(me).toMatchObject({ name: "default" });
    const [listed] = (await (await server.api("/api/tokens")).json()) as ApiToken[];
    expect(listed!.lastUsedAt).not.toBeNull();

    expect((await server.api(`/api/tokens/${id}`, { method: "DELETE" })).status).toBe(204);
    const rejected = await server.api("/api/library", { headers: { Authorization: `Bearer ${token}` } });
    expect(rejected.status).toBe(401);
    expect((await server.api("/api/library", { headers: { Authorization: "Bearer nope" } })).status).toBe(401);
  });

  test("uploads without OCR fields follow the user's settings", async () => {
    await patch("/api/settings", { autoOcr: true });
    const [doc] = await upload([{ name: "scan.jpg", data: await makeJpeg(), type: "image/jpeg" }]);
    expect(doc!.ocrStatus).toBe("pending");
    const [explicit] = await upload([{ name: "scan.jpg", data: await makeJpeg(), type: "image/jpeg" }], { ocr: "false" });
    expect(explicit!.ocrStatus).toBe("none");
  });
});

describe("shapes", () => {
  const black = { id: "a", type: "rect" as const, x: 0, y: 0, width: 0.5, height: 1, color: "#000000" };
  const pixel = async (id: number, asset: string, x: number, y: number) => {
    const image = await Jimp.read(Buffer.from(await (await server.api(`/api/documents/${id}/${asset}`)).arrayBuffer()));
    return image.getPixelColor(x, y) >>> 8;
  };
  const isDark = (rgb: number) => ((rgb >> 16) & 0xff) < 40 && ((rgb >> 8) & 0xff) < 40 && (rgb & 0xff) < 40;

  test("are drawn onto the edited image and kept for editing", async () => {
    const doc = await uploadImage();
    const res = await patch(`/api/documents/${doc.id}`, { shapes: [black, { ...black, id: "b", color: "nope" }] });
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ArchiveDocument;
    expect(updated.shapes).toEqual([black]);
    expect(updated.shapesOutdated).toBe(false);
    expect(isDark(await pixel(doc.id, "image", 10, 20))).toBe(true);
    expect(isDark(await pixel(doc.id, "image", 50, 20))).toBe(false);
    expect(isDark(await pixel(doc.id, "thumbnail", 10, 20))).toBe(true);
    // The editor draws on the image without them.
    expect(isDark(await pixel(doc.id, "edited", 10, 20))).toBe(false);

    const removed = (await (await patch(`/api/documents/${doc.id}`, { shapes: [] })).json()) as ArchiveDocument;
    expect(removed.shapes).toEqual([]);
    expect(isDark(await pixel(doc.id, "image", 10, 20))).toBe(false);
    expect(await server.ctx.storage.exists(derivedKeys.edited(doc.id))).toBe(false);
  });

  test("recognize the text again when they change and the image had text", async () => {
    const plain = await uploadImage("ohne.jpg");
    await patch(`/api/documents/${plain.id}`, { shapes: [black] });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(0);

    const doc = await uploadImage("mit.jpg", { ocr: "true", ocrAllText: "true" });
    await server.ctx.ocr.idle();
    const saved = (await (await patch(`/api/documents/${doc.id}`, { shapes: [black] })).json()) as ArchiveDocument;
    expect(saved.ocrStatus).toBe("pending");
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(2);
    expect(server.ctx.documents.getById(doc.id)?.ocrAllText).toBe(true);
    // The recognized image has the shapes on it.
    const recognized = await Jimp.read(Buffer.from(server.ocr.images[1]!));
    expect(isDark(recognized.getPixelColor(10, 20) >>> 8)).toBe(true);

    await patch(`/api/documents/${doc.id}`, { shapes: [black], title: "gleich" });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(2);
  });

  test("are marked as outdated when the geometry changes afterwards", async () => {
    const doc = await uploadImage();
    await patch(`/api/documents/${doc.id}`, { shapes: [black] });
    const toned = (await (await patch(`/api/documents/${doc.id}`, { editSettings: { brightness: 0.2 } })).json()) as ArchiveDocument;
    expect(toned.shapesOutdated).toBe(false);
    const rotated = (await (await patch(`/api/documents/${doc.id}`, { editSettings: { rotation: 90 } })).json()) as ArchiveDocument;
    expect(rotated).toMatchObject({ shapes: [black], shapesOutdated: true });
    const redrawn = (await (await patch(`/api/documents/${doc.id}`, { shapes: [{ ...black, width: 0.4 }] })).json()) as ArchiveDocument;
    expect(redrawn.shapesOutdated).toBe(false);
  });

  test("can be stored in an image preset and applied on import, in batch jobs and in the editor", async () => {
    const preset = (await (await post("/api/presets", { name: "Schwärzen", steps: { shapes: [black] } })).json()) as ImagePreset;
    expect(preset.steps).toEqual({ shapes: [black] });

    const doc = await uploadImage();
    const applied = (await (await post(`/api/documents/${doc.id}/apply-preset`, { presetId: preset.id })).json()) as { shapes: unknown };
    expect(applied.shapes).toEqual([black]);
    expect(server.ctx.documents.getById(doc.id)?.shapes).toEqual([]);

    const res = await post("/api/jobs", { kind: "batch", documentIds: [doc.id], presetId: preset.id, ocr: false });
    expect(res.status).toBe(201);
    await server.ctx.jobQueue.idle();
    expect(server.ctx.documents.getById(doc.id)).toMatchObject({ shapes: [black], shapesOutdated: false });
    expect(isDark(await pixel(doc.id, "image", 10, 20))).toBe(true);

    await patch("/api/settings", { importPresetId: preset.id });
    const imported = await uploadImage("neu.jpg");
    expect(imported.shapes).toEqual([black]);
    expect(isDark(await pixel(imported.id, "image", 10, 20))).toBe(true);
    expect(isDark(await pixel(imported.id, "edited", 10, 20))).toBe(false);
  });

  test("only exist for images", async () => {
    const [pdf] = await upload([{ name: "a.pdf", data: makePdf("Hallo"), type: "application/pdf" }]);
    expect((await patch(`/api/documents/${pdf!.id}`, { shapes: [black] })).status).toBe(400);
    const doc = await uploadImage();
    expect((await patch(`/api/documents/${doc.id}`, { shapes: "x" })).status).toBe(400);
  });
});

describe("vectors", () => {
  // The left half of the area black, the right half white.
  const area = {
    id: "v1",
    x: 0,
    y: 0,
    width: 0.5,
    height: 1,
    settings: { mode: "bw", detail: 3, curves: "smooth", threshold: 128 },
    graphic: { width: 10, height: 10, background: "#ffffff", paths: [{ d: "M0 0L5 0L5 10L0 10Z", fill: "#000000" }] },
  };
  const put = (id: number, body: unknown) =>
    server.api(`/api/documents/${id}/vectors`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const pixelOf = async (data: Uint8Array | ArrayBuffer, x: number, y: number) => (await Jimp.read(Buffer.from(data as ArrayBuffer))).getPixelColor(x, y) >>> 8;
  const pixel = async (id: number, asset: string, x: number, y: number) => pixelOf(await (await server.api(`/api/documents/${id}/${asset}`)).arrayBuffer(), x, y);
  const channels = (rgb: number) => [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];
  const isDark = (rgb: number) => channels(rgb).every((c) => c < 40);
  const isWhite = (rgb: number) => channels(rgb).every((c) => c > 215);

  test("replace the pixels of their areas and are kept apart from the documents", async () => {
    const doc = await uploadImage();
    expect(doc).toMatchObject({ vectorCount: 0, vectorsOutdated: false });
    const res = await put(doc.id, { areas: [area, { ...area, id: "pending", x: 0.6, width: 0.3, graphic: null }] });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as { document: ArchiveDocument; areas: unknown[] };
    // Areas that were not vectorized are dropped.
    expect(saved.areas).toEqual([area]);
    expect(saved.document.vectorCount).toBe(1);

    expect(isDark(await pixel(doc.id, "image", 5, 20))).toBe(true);
    expect(isWhite(await pixel(doc.id, "image", 25, 20))).toBe(true);
    expect(isWhite(await pixel(doc.id, "image", 50, 20))).toBe(false);
    expect(isDark(await pixel(doc.id, "thumbnail", 5, 20))).toBe(true);
    // The editor vectorizes the image without them.
    expect(isDark(await pixel(doc.id, "edited", 5, 20))).toBe(false);

    expect(await (await server.api(`/api/documents/${doc.id}/vectors`)).json()).toEqual({ areas: [area], outdated: false });
    const listed = (await (await server.api("/api/library")).json()) as LibraryItem[];
    expect(listed.find((item) => item.type === "document" && item.document.id === doc.id)).toMatchObject({ document: { vectorCount: 1 } });

    const removed = (await (await put(doc.id, { areas: [] })).json()) as { document: ArchiveDocument };
    expect(removed.document.vectorCount).toBe(0);
    expect(isDark(await pixel(doc.id, "image", 5, 20))).toBe(false);
    expect(await server.ctx.storage.exists(derivedKeys.edited(doc.id))).toBe(false);
  });

  test("shapes are drawn on top of them", async () => {
    const doc = await uploadImage();
    await put(doc.id, { areas: [area] });
    await patch(`/api/documents/${doc.id}`, { shapes: [{ id: "s", type: "rect", x: 0, y: 0, width: 1, height: 0.25, color: "#ffffff" }] });
    expect(isWhite(await pixel(doc.id, "image", 5, 5))).toBe(true);
    expect(isDark(await pixel(doc.id, "image", 5, 30))).toBe(true);
  });

  test("recognize the text again when they change and the image had text", async () => {
    const doc = await uploadImage("mit.jpg", { ocr: "true" });
    await server.ctx.ocr.idle();
    const saved = (await (await put(doc.id, { areas: [area] })).json()) as { document: ArchiveDocument };
    expect(saved.document.ocrStatus).toBe("pending");
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(2);
    expect(isDark(await pixelOf(server.ocr.images[1]!, 5, 20))).toBe(true);

    await put(doc.id, { areas: [area] });
    await server.ctx.ocr.idle();
    expect(server.ocr.calls).toBe(2);
  });

  test("are exported to the PDF as vectors over an image whose areas are left blank", async () => {
    const doc = await uploadImage();
    await put(doc.id, { areas: [area] });
    await patch(`/api/documents/${doc.id}`, { shapes: [{ id: "s", type: "rect", x: 0, y: 0, width: 1, height: 0.25, color: "#ffffff" }] });

    const stored = server.ctx.documents.getById(doc.id)!;
    for (const quality of ["medium", "original"] as const) {
      const raster = await server.ctx.imaging.pdfImage(stored, quality);
      expect([raster.width, raster.height]).toEqual([64, 48]);
      expect(raster.image.kind).toBe(quality === "original" ? "png" : "jpeg");
      if (raster.image.kind === "bilevel") throw new Error("expected a color image");
      expect(isWhite(await pixelOf(raster.image.data, 5, 30))).toBe(true);
      expect(isWhite(await pixelOf(raster.image.data, 50, 30))).toBe(false);
    }

    const res = await post(`/api/documents/${doc.id}/pdf`, {});
    expect(res.status).toBe(200);
    const page = await Jimp.read(Buffer.from(await renderPdfPage(new Uint8Array(await res.arrayBuffer()), 1, 1)));
    const at = (x: number, y: number) => page.getPixelColor(Math.round(x * page.bitmap.width), Math.round(y * page.bitmap.height)) >>> 8;
    expect(isDark(at(0.1, 0.6))).toBe(true);
    expect(isWhite(at(0.4, 0.6))).toBe(true);
    expect(isWhite(at(0.1, 0.1))).toBe(true);
    expect(isWhite(at(0.8, 0.6))).toBe(false);
  });

  test("are marked as outdated when the geometry changes afterwards", async () => {
    const doc = await uploadImage();
    await put(doc.id, { areas: [area] });
    const rotated = (await (await patch(`/api/documents/${doc.id}`, { editSettings: { rotation: 90 } })).json()) as ArchiveDocument;
    expect(rotated).toMatchObject({ vectorCount: 1, vectorsOutdated: true });
    expect(((await (await server.api(`/api/documents/${doc.id}/vectors`)).json()) as { outdated: boolean }).outdated).toBe(true);
    const again = (await (await put(doc.id, { areas: [area] })).json()) as { document: ArchiveDocument };
    expect(again.document.vectorsOutdated).toBe(false);
  });

  test("only images can be vectorized, invalid bodies are rejected and deleting the document removes them", async () => {
    const [pdf] = await upload([{ name: "a.pdf", data: makePdf("Hallo"), type: "application/pdf" }]);
    expect((await put(pdf!.id, { areas: [area] })).status).toBe(400);
    const doc = await uploadImage();
    expect((await put(doc.id, { areas: "nope" })).status).toBe(400);
    expect((await put(999, { areas: [] })).status).toBe(404);
    await put(doc.id, { areas: [area] });
    await server.api(`/api/documents/${doc.id}`, { method: "DELETE" });
    expect(server.ctx.db.query("SELECT COUNT(*) AS n FROM document_vectors").get()).toEqual({ n: 0 });
  });
});

describe("duplicates", () => {
  const getDocument = async (id: number) => (await (await server.api(`/api/documents/${id}`)).json()) as ArchiveDocument;
  const duplicate = async (id: number) => {
    const res = await post(`/api/documents/${id}/duplicate`, {});
    expect(res.status).toBe(201);
    return (await res.json()) as ArchiveDocument;
  };
  const storageKey = (id: number) => server.ctx.documents.getById(id)!.storageKey;

  test("copy the edits, text, folders and shapes and share the original file", async () => {
    const doc = await uploadImage("Brief.jpg", { folders: JSON.stringify(["wichtig"]) });
    await patch(`/api/documents/${doc.id}`, { editSettings: { rotation: 90 }, ocrText: "Hallo", shapes: [{ id: "s", type: "rect", x: 0, y: 0, width: 0.1, height: 0.1, color: "#000000" }] });
    const copy = await duplicate(doc.id);
    expect(copy).toMatchObject({ title: "Brief (Kopie)", folders: ["wichtig"], ocrText: "Hallo", copyOf: { id: doc.id, title: "Brief" }, copies: [] });
    expect(copy.editSettings.rotation).toBe(90);
    expect(copy.shapes).toHaveLength(1);
    expect(storageKey(copy.id)).toBe(storageKey(doc.id));
    expect((await server.api(`/api/documents/${copy.id}/thumbnail`)).status).toBe(200);
    expect((await getDocument(doc.id)).copies).toEqual([{ id: copy.id, title: "Brief (Kopie)" }]);

    // Duplicates of a duplicate belong to the original.
    const second = await duplicate(copy.id);
    expect(second.copyOf).toEqual({ id: doc.id, title: "Brief" });
    expect((await getDocument(doc.id)).copies.map((c) => c.id)).toEqual([copy.id, second.id]);
  });

  test("are placed after the document in its stack", async () => {
    const [a, b] = [await uploadImage(), await uploadImage()];
    const stack = (await (await post("/api/stacks", { documentIds: [a.id, b.id] })).json()) as StackWithDocuments;
    const copy = await duplicate(a.id);
    const updated = (await (await server.api(`/api/stacks/${stack.id}`)).json()) as StackWithDocuments;
    expect(updated.documentIds).toEqual([a.id, copy.id, b.id]);
  });

  test("keep the file when the original is deleted; the oldest becomes the new original", async () => {
    const doc = await uploadImage();
    const [first, second] = [await duplicate(doc.id), await duplicate(doc.id)];
    const key = storageKey(doc.id);
    expect((await server.api(`/api/documents/${doc.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await server.ctx.storage.exists(key)).toBe(true);
    expect(await getDocument(first.id)).toMatchObject({ copyOf: null, copies: [{ id: second.id }] });
    expect((await getDocument(second.id)).copyOf?.id).toBe(first.id);
    expect((await server.api(`/api/documents/${second.id}/file`)).status).toBe(200);

    await server.api(`/api/documents/${first.id}`, { method: "DELETE" });
    await server.api(`/api/documents/${second.id}`, { method: "DELETE" });
    expect(await server.ctx.storage.exists(key)).toBe(false);
  });

  test("can be made independent with their own copy of the file", async () => {
    const doc = await uploadImage();
    const copy = await duplicate(doc.id);
    expect((await post(`/api/documents/${doc.id}/detach`, {})).status).toBe(400);
    const res = await post(`/api/documents/${copy.id}/detach`, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ copyOf: null });
    expect((await getDocument(doc.id)).copies).toEqual([]);
    expect(storageKey(copy.id)).not.toBe(storageKey(doc.id));
    await server.api(`/api/documents/${doc.id}`, { method: "DELETE" });
    expect((await server.api(`/api/documents/${copy.id}/file`)).status).toBe(200);
  });
});
