import { basename, extname } from "node:path";
import { isDefaultEditSettings, normalizeEditSettings } from "../../shared/editSettings";
import { quadFromMask } from "../../shared/image/autoCrop";
import { normalizeFolderPath } from "../../shared/folders";
import { isOcrLanguage } from "../../shared/languages";
import { applyFixedSteps, type PresetSteps } from "../../shared/presets";
import type { PdfQuality } from "../../shared/settings";
import type {
  ArchiveDocument,
  BwVariant,
  DewarpGrid,
  DocumentUpdate,
  EditSettings,
  LibraryItem,
  LibraryItemRef,
  LibraryQuery,
  LibrarySort,
  Quad,
  Rotation,
  Stack,
  StackCreate,
  StackUpdate,
  StackWithDocuments,
  UploadedDocument,
} from "../../shared/types";
import { type DocumentRepository, type StoredDocument, toPublicDocument } from "../db/documents";
import type { FolderRepository } from "../db/folders";
import type { StackRepository } from "../db/stacks";
import type { VectorRepository } from "../db/vectors";
import { normalizeVectorAreas, type VectorArea } from "../../vectorizer";
import { normalizeShapes, shapeGeometry } from "../../shared/shapes";
import { HttpError } from "../http";
import { derivedKeys, type FileStorage } from "../storage";
import { extensionFor, type ImagingService } from "./imaging";
import { detectLanguage } from "./language";
import { createSearchablePdf, type PdfPart } from "./searchablePdf";
import { type DewarpEngine, toDewarpGrid } from "./dewarp";
import type { DocumentSegmenter } from "./documentSegmentation";
import type { OcrEngine, OcrOptions, OcrQueue } from "./ocr";

// Tesseract's orientation confidence; pages without enough text stay below this.
const MIN_ORIENTATION_CONFIDENCE = 2;

export interface UploadOptions {
  folders?: string[];
  stackId?: number;
  runOcr?: boolean;
  ocrAllText?: boolean;
  /** Image preset applied to every uploaded image. */
  preset?: PresetSteps;
  /** Recognition languages for the uploads; null or left out detects the language (`OcrOptions.detectLanguage`). */
  ocrLanguages?: string[] | null;
  /** Replaces the upload time (ISO 8601), e.g. with the file's creation date. */
  createdAt?: string;
}

export interface UploadFile {
  name: string;
  type: string;
  data: Uint8Array;
}

export class ArchiveService {
  constructor(
    private documents: DocumentRepository,
    private stacks: StackRepository,
    private folders: FolderRepository,
    private storage: FileStorage,
    private imaging: ImagingService,
    private ocr: OcrQueue,
    private dewarp: DewarpEngine,
    private segmenter: DocumentSegmenter,
    private ocrEngine: OcrEngine,
    private vectors: VectorRepository,
  ) {}

  library(userId: number, query: LibraryQuery): LibraryItem[] {
    const filter = { folder: query.folder ? normalizeFolderPath(query.folder) : undefined, q: query.q?.trim() || undefined };
    const items: LibraryItem[] = [
      ...this.stacks.list(userId, filter).map((stack) => ({ type: "stack" as const, stack })),
      ...this.documents.list(userId, { ...filter, stackId: null }).map((doc) => ({ type: "document" as const, document: toPublicDocument(doc) })),
    ];
    const folderId = filter.folder && query.sort === "custom" ? this.folders.idByPath(userId, filter.folder) : null;
    return sortLibrary(items, query.sort ?? "updated", folderId === null ? new Map() : this.folders.order(folderId));
  }

  /** Stores the order of the items the user arranged in a folder; items left out go to the end. */
  setFolderOrder(userId: number, folder: string, items: LibraryItemRef[]): void {
    this.folders.setOrder(this.folders.ensure(userId, folder), items);
  }

  getDocument(userId: number, id: number): StoredDocument {
    const doc = this.documents.get(userId, id);
    if (!doc) throw new HttpError(404, "Document not found");
    return doc;
  }

  async upload(userId: number, files: UploadFile[], options: UploadOptions = {}): Promise<UploadedDocument[]> {
    if (files.length === 0) throw new HttpError(400, "No files uploaded");
    if (options.stackId !== undefined) this.getStack(userId, options.stackId);

    const created: StoredDocument[] = [];
    const duplicates = new Map<number, UploadedDocument["duplicates"]>();
    for (const file of files) {
      const sha256 = sha256Hex(file.data);
      const name = basename(file.name || "upload");
      const inspection = await this.imaging.inspect(file.data, name, file.type);
      const storageKey = `originals/${userId}/${crypto.randomUUID()}${extensionFor(name, inspection.mimeType)}`;
      await this.storage.write(storageKey, file.data);

      const hasEmbeddedText = inspection.kind === "pdf" && inspection.text.length > 0;
      let doc = this.documents.create({
        userId,
        title: basename(name, extname(name)),
        originalName: name,
        mimeType: inspection.mimeType,
        kind: inspection.kind,
        size: file.data.byteLength,
        storageKey,
        sha256,
        width: inspection.width,
        height: inspection.height,
        pageCount: inspection.pageCount,
        ocrText: inspection.text,
        ocrStatus: hasEmbeddedText ? "done" : "none",
        ocrLanguage: hasEmbeddedText ? detectLanguage(inspection.text) : null,
        metadata: hasEmbeddedText ? { ...inspection.metadata, textSource: "pdf" } : inspection.metadata,
        createdAt: options.createdAt,
      });
      duplicates.set(
        doc.id,
        this.documents.findBySha256(userId, sha256, doc.id).map((other) => ({ id: other.id, title: other.title.trim() || other.originalName })),
      );
      if (options.folders?.length) this.folders.setForDocument(userId, doc.id, options.folders);
      if (options.ocrLanguages?.length && doc.kind !== "file") {
        this.documents.setOcrLanguages(doc.id, options.ocrLanguages);
        doc = this.documents.get(userId, doc.id)!;
      }
      if (doc.kind === "image" && options.preset) doc = await this.applyPresetOnUpload(doc, options.preset);
      const size = await this.imaging.renderDerivatives(doc);
      if (size && !isDefaultEditSettings(doc.editSettings)) this.documents.update(userId, doc.id, size);
      doc = this.documents.get(userId, doc.id)!;
      created.push(doc);
    }

    if (options.stackId !== undefined) {
      const stack = this.getStack(userId, options.stackId);
      this.documents.assignToStack(userId, stack.id, [...stack.documentIds, ...created.map((d) => d.id)]);
      this.stacks.touch(stack.id);
    }

    if (options.runOcr) {
      for (const doc of created) {
        if (doc.kind !== "file" && doc.ocrStatus !== "done") this.ocr.enqueue(doc.id, { allText: options.ocrAllText, detectLanguage: !options.ocrLanguages?.length });
      }
    }

    return created.map((doc) => ({ ...toPublicDocument(this.documents.get(userId, doc.id)!), duplicates: duplicates.get(doc.id) ?? [] }));
  }

  /** Records the SHA-256 of files stored before hashes were kept; returns how many were hashed. */
  async hashMissingFiles(): Promise<number> {
    let hashed = 0;
    for (const { id, storageKey } of this.documents.withoutSha256()) {
      try {
        this.documents.setSha256(id, sha256Hex(await this.storage.read(storageKey)));
        hashed++;
      } catch (error) {
        console.warn(`Could not hash the file of document ${id}:`, error);
      }
    }
    return hashed;
  }

  async updateDocument(userId: number, id: number, update: DocumentUpdate): Promise<ArchiveDocument> {
    const doc = this.getDocument(userId, id);
    const fields: Parameters<DocumentRepository["update"]>[2] = {};
    if (typeof update.title === "string") fields.title = update.title.trim();
    if (typeof update.ocrText === "string") {
      fields.ocrText = update.ocrText;
      fields.ocrLanguage = detectLanguage(update.ocrText);
    }
    if (update.editSettings !== undefined) {
      if (doc.kind !== "image") throw new HttpError(400, "Only images can be edited");
      fields.editSettings = normalizeEditSettings(update.editSettings, doc.editSettings);
    }
    if (update.shapes !== undefined) {
      if (doc.kind !== "image") throw new HttpError(400, "Only images can have shapes");
      if (!Array.isArray(update.shapes)) throw new HttpError(400, "shapes must be a list");
      const shapes = normalizeShapes(update.shapes);
      fields.shapes = shapes.length > 0 ? { shapes, geometry: shapeGeometry(fields.editSettings ?? doc.editSettings) } : null;
    }
    if (Array.isArray(update.folders)) this.folders.setForDocument(userId, id, update.folders.map(String));

    const shapesChanged = fields.shapes !== undefined && JSON.stringify(fields.shapes?.shapes ?? []) !== JSON.stringify(doc.shapes);
    let updated = this.documents.update(userId, id, fields)!;
    if (fields.editSettings || shapesChanged) {
      const size = await this.imaging.renderDerivatives(updated);
      if (size) updated = this.documents.update(userId, id, size)!;
    }
    if (updated.stackId !== null) this.stacks.touch(updated.stackId);
    // Text under the shapes (e.g. blacked out) must disappear from the recognized text, the search and PDF exports.
    if (shapesChanged && updated.ocrStatus !== "none") {
      this.ocr.enqueue(id, { allText: updated.ocrAllText });
      updated = this.documents.get(userId, id)!;
    }
    return toPublicDocument(updated);
  }

  /** The vectorized areas of an image and whether rotation, crop or dewarping changed since. */
  getVectors(userId: number, id: number): { areas: VectorArea[]; outdated: boolean } {
    const doc = this.getDocument(userId, id);
    const layer = this.vectors.get(userId, doc.id);
    return { areas: layer?.areas ?? [], outdated: doc.vectorsOutdated };
  }

  /** Replaces the vectorized areas (those without a graphic are dropped) and renders the image with them. */
  async setVectors(userId: number, id: number, value: unknown): Promise<{ document: ArchiveDocument; areas: VectorArea[] }> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be vectorized");
    if (!Array.isArray(value)) throw new HttpError(400, "areas must be a list");
    const areas = normalizeVectorAreas(value).filter((area) => area.graphic !== null);
    const before = JSON.stringify(this.vectors.get(userId, id)?.areas ?? []);
    this.vectors.set(id, { areas, geometry: shapeGeometry(doc.editSettings) });
    let updated = this.documents.get(userId, id)!;
    if (JSON.stringify(areas) !== before) {
      await this.imaging.renderDerivatives(updated);
      this.documents.touch(id);
      if (updated.stackId !== null) this.stacks.touch(updated.stackId);
      // Vectorized text reads differently, and replaced text must not stay in the search and PDF exports.
      if (updated.ocrStatus !== "none") this.ocr.enqueue(id, { allText: updated.ocrAllText });
      updated = this.documents.get(userId, id)!;
    }
    return { document: toPublicDocument(updated), areas };
  }

  /** The original file stays as long as a duplicate uses it; the oldest duplicate then becomes the original. */
  async deleteDocument(userId: number, id: number): Promise<void> {
    const doc = this.getDocument(userId, id);
    this.documents.handOverCopies(id);
    this.documents.delete(userId, id);
    if (doc.stackId !== null) this.stacks.deleteIfEmpty(doc.stackId);
    if (!this.documents.storageKeyInUse(doc.storageKey)) await this.storage.delete(doc.storageKey);
    await this.storage.delete(derivedKeys.dir(id));
  }

  /** A copy with the same edits, text and folders that uses the same original file, placed after the document in its stack. */
  async duplicateDocument(userId: number, id: number): Promise<ArchiveDocument> {
    const doc = this.getDocument(userId, id);
    const title = `${doc.title.trim() || basename(doc.originalName, extname(doc.originalName))} (Kopie)`;
    const copy = this.documents.duplicate(userId, id, title);
    await this.storage.copy(derivedKeys.dir(id), derivedKeys.dir(copy.id));
    if (doc.stackId !== null) {
      const ids = this.getStack(userId, doc.stackId).documentIds.filter((docId) => docId !== copy.id);
      ids.splice(ids.indexOf(id) + 1, 0, copy.id);
      this.documents.assignToStack(userId, doc.stackId, ids);
      this.stacks.touch(doc.stackId);
    }
    if (copy.ocrStatus === "pending" || copy.ocrStatus === "running") this.ocr.enqueue(copy.id, { allText: copy.ocrAllText });
    return toPublicDocument(this.documents.get(userId, copy.id)!);
  }

  /** Gives a duplicate its own copy of the original file and ends its relation to the original. */
  async detachDocument(userId: number, id: number): Promise<ArchiveDocument> {
    const doc = this.getDocument(userId, id);
    if (doc.copyOf === null) throw new HttpError(400, "Document is not a duplicate");
    if (!(await this.storage.exists(doc.storageKey))) throw new HttpError(404, "File not found");
    const storageKey = `originals/${userId}/${crypto.randomUUID()}${extname(doc.storageKey)}`;
    await this.storage.copy(doc.storageKey, storageKey);
    this.documents.detach(userId, id, storageKey);
    return toPublicDocument(this.documents.get(userId, id)!);
  }

  /** Detects the language of texts stored without one; returns how many were found. */
  detectMissingLanguages(): number {
    let found = 0;
    for (const { id, text } of this.documents.withoutLanguage()) {
      const language = detectLanguage(text);
      if (!language) continue;
      this.documents.setOcrLanguage(id, language);
      found++;
    }
    return found;
  }

  /** Queues OCR; `languages` replaces the document's recognition languages (null: back to the default). */
  requestOcr(userId: number, id: number, options: OcrOptions = {}, languages?: string[] | null): ArchiveDocument {
    const doc = this.getDocument(userId, id);
    if (doc.kind === "file") throw new HttpError(400, "OCR is only available for images and PDFs");
    if (languages !== undefined) {
      if (languages !== null && (languages.length === 0 || !languages.every(isOcrLanguage))) throw new HttpError(400, "Unknown OCR language");
      this.documents.setOcrLanguages(id, languages);
    }
    this.ocr.enqueue(id, options);
    return toPublicDocument(this.documents.get(userId, id)!);
  }

  async detectDewarp(userId: number, id: number, rotation: Rotation): Promise<DewarpGrid> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be dewarped");
    if (!this.dewarp.available()) throw new HttpError(503, "Dewarping model is not installed");
    return toDewarpGrid(await this.dewarp.predict(await this.imaging.uprightImage(doc, rotation)), rotation);
  }

  /** The edited image as a PDF page with the text (default: the stored OCR text) as a searchable layer. */
  async exportPdf(userId: number, id: number, text: string | undefined, quality: PdfQuality): Promise<{ pdf: Uint8Array<ArrayBuffer>; filename: string }> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be exported as PDF");
    const title = doc.title.trim() || basename(doc.originalName, extname(doc.originalName));
    const pdf = await createSearchablePdf([await this.pdfPart(userId, doc, quality, text)], title);
    return { pdf, filename: `${title}.pdf` };
  }

  /** Images (as searchable pages) and PDFs of several documents in the given order as one PDF; other files are left out. */
  async exportCombinedPdf(
    userId: number,
    ids: number[],
    title: string | undefined,
    quality: PdfQuality,
  ): Promise<{ pdf: Uint8Array<ArrayBuffer>; filename: string }> {
    const docs = ids.map((id) => this.getDocument(userId, id)).filter((doc) => doc.kind !== "file");
    if (docs.length === 0) throw new HttpError(400, "No images or PDFs selected");
    const parts: PdfPart[] = [];
    for (const doc of docs) parts.push(await this.pdfPart(userId, doc, quality));
    const name = title?.trim() || "Documents";
    return { pdf: await createSearchablePdf(parts, name), filename: `${name}.pdf` };
  }

  private async pdfPart(userId: number, doc: StoredDocument, quality: PdfQuality, text?: string): Promise<PdfPart> {
    if (doc.kind === "pdf") return { kind: "pdf", name: doc.originalName, data: await this.storage.read(doc.storageKey) };
    const { image, width, height, vectors } = await this.imaging.pdfImage(doc, quality);
    const layout = this.documents.getOcrLayout(userId, doc.id);
    const current = layout && JSON.stringify(layout.editSettings) === JSON.stringify(doc.editSettings) ? layout : null;
    const overlay = vectors.length > 0 ? { width, height, vectors, shapes: doc.shapes } : null;
    return { kind: "image", image, text: text ?? doc.ocrText, layout: current, overlay };
  }

  async autoBw(userId: number, id: number, settings: Partial<EditSettings> = {}): Promise<BwVariant[]> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be edited");
    return this.imaging.autoBwVariants(doc, normalizeEditSettings(settings, doc.editSettings));
  }

  /** Rotation of the original that turns its text upright, or null if there is not enough text to tell. */
  async detectOrientation(userId: number, id: number): Promise<Rotation | null> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be rotated");
    return this.orientationOf(doc);
  }

  autoCropAvailable(): boolean {
    return this.segmenter.available();
  }

  /** Corners of the page in the image after rotation and dewarping, or null if no page outline was found. */
  async detectCrop(userId: number, id: number, settings: Partial<EditSettings> = {}): Promise<Quad | null> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be cropped");
    if (!this.segmenter.available()) throw new HttpError(503, "Document segmentation model is not installed");
    return await this.cropOf(doc, normalizeEditSettings(settings, doc.editSettings));
  }

  private async cropOf(doc: StoredDocument, settings: EditSettings): Promise<Quad | null> {
    const mask = await this.segmenter.segment(await this.imaging.cropInput(doc, settings));
    return quadFromMask(mask.data, mask.width, mask.height);
  }

  /** The edit settings after applying a preset's steps on top of `settings` (default: the stored ones); nothing is saved. */
  async applyPreset(userId: number, id: number, steps: PresetSteps, settings?: Partial<EditSettings>): Promise<EditSettings> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be edited");
    return this.presetSettings(doc, steps, normalizeEditSettings(settings ?? {}, doc.editSettings));
  }

  private async presetSettings(doc: StoredDocument, steps: PresetSteps, base: EditSettings): Promise<EditSettings> {
    let settings = base;
    const rotate = (rotation: Rotation) => {
      if (rotation !== settings.rotation) settings = { ...settings, rotation, dewarp: null, corners: null };
    };
    if (steps.autoRotate) {
      const rotation = await this.orientationOf(doc).catch((error) => {
        console.warn(`Orientation detection failed for document ${doc.id}:`, error);
        return null;
      });
      if (rotation !== null) rotate(rotation);
    } else if (steps.rotation !== undefined) rotate(steps.rotation);
    if (steps.autoDewarp && this.dewarp.available()) {
      const upright = await this.imaging.uprightImage(doc, settings.rotation);
      settings = { ...settings, dewarp: toDewarpGrid(await this.dewarp.predict(upright), settings.rotation), corners: null };
    }
    if (steps.autoCrop && this.segmenter.available()) {
      const corners = await this.cropOf(doc, settings).catch((error) => {
        console.warn(`Page detection failed for document ${doc.id}:`, error);
        return null;
      });
      if (corners) settings = { ...settings, corners };
    }
    settings = applyFixedSteps(settings, steps);
    if (steps.autoBw) {
      const [best] = await this.imaging.autoBwVariants(doc, settings);
      if (best) settings = { ...settings, ...best, colorMode: "bw" };
    }
    return normalizeEditSettings(settings);
  }

  private async applyPresetOnUpload(doc: StoredDocument, steps: PresetSteps): Promise<StoredDocument> {
    try {
      const editSettings = await this.presetSettings(doc, steps, doc.editSettings);
      const shapes = steps.shapes ? { shapes: steps.shapes, geometry: shapeGeometry(editSettings) } : undefined;
      return this.documents.update(doc.userId, doc.id, { editSettings, shapes }) ?? doc;
    } catch (error) {
      console.warn(`Image preset failed for document ${doc.id}:`, error);
      return doc;
    }
  }

  private async orientationOf(doc: StoredDocument): Promise<Rotation | null> {
    const orientation = await this.ocrEngine.detectOrientation(await this.imaging.orientationInput(doc));
    return orientation && orientation.confidence >= MIN_ORIENTATION_CONFIDENCE ? orientation.rotation : null;
  }

  /** Renders the full-resolution result of unsaved edit settings without storing anything. */
  async renderPreview(userId: number, id: number, settings: Partial<EditSettings> = {}): Promise<Uint8Array<ArrayBuffer>> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be edited");
    return this.imaging.renderJpeg(doc, normalizeEditSettings(settings, doc.editSettings));
  }

  getStack(userId: number, id: number): Stack {
    const stack = this.stacks.get(userId, id);
    if (!stack) throw new HttpError(404, "Stack not found");
    return stack;
  }

  getStackWithDocuments(userId: number, id: number): StackWithDocuments {
    const stack = this.getStack(userId, id);
    return { ...stack, documents: this.documents.list(userId, { stackId: id }).map(toPublicDocument) };
  }

  createStack(userId: number, input: StackCreate): StackWithDocuments {
    const ids = this.validDocumentIds(userId, input.documentIds);
    if (ids.length === 0) throw new HttpError(400, "A stack needs at least one document");
    const first = this.getDocument(userId, ids[0]!);
    const stackId = this.stacks.create(userId, input.title?.trim() || first.title);
    this.moveDocumentsToStack(userId, stackId, ids);
    if (input.folders?.length) this.folders.setForStack(userId, stackId, input.folders);
    return this.getStackWithDocuments(userId, stackId);
  }

  updateStack(userId: number, id: number, update: StackUpdate): StackWithDocuments | null {
    const stack = this.getStack(userId, id);
    if (Array.isArray(update.documentIds)) {
      const ids = this.validDocumentIds(userId, update.documentIds);
      const removed = stack.documentIds.filter((docId) => !ids.includes(docId));
      this.documents.assignToStack(userId, null, removed);
      this.moveDocumentsToStack(userId, id, ids);
    }
    if (Array.isArray(update.folders)) this.folders.setForStack(userId, id, update.folders.map(String));
    this.stacks.update(userId, id, { title: typeof update.title === "string" ? update.title.trim() : undefined });
    if (!this.stacks.get(userId, id)?.documentIds.length) {
      this.stacks.delete(userId, id);
      return null;
    }
    return this.getStackWithDocuments(userId, id);
  }

  addToStack(userId: number, id: number, documentIds: number[]): StackWithDocuments {
    const stack = this.getStack(userId, id);
    const ids = this.validDocumentIds(userId, documentIds).filter((docId) => !stack.documentIds.includes(docId));
    this.moveDocumentsToStack(userId, id, [...stack.documentIds, ...ids]);
    return this.getStackWithDocuments(userId, id);
  }

  deleteStack(userId: number, id: number): void {
    const stack = this.getStack(userId, id);
    this.documents.assignToStack(userId, null, stack.documentIds);
    this.stacks.delete(userId, id);
  }

  private moveDocumentsToStack(userId: number, stackId: number, ids: number[]): void {
    const previousStacks = new Set(
      ids.map((docId) => this.documents.get(userId, docId)!.stackId).filter((s): s is number => s !== null && s !== stackId),
    );
    this.documents.assignToStack(userId, stackId, ids);
    this.stacks.touch(stackId);
    for (const previous of previousStacks) this.stacks.deleteIfEmpty(previous);
  }

  private validDocumentIds(userId: number, ids: unknown): number[] {
    if (!Array.isArray(ids)) throw new HttpError(400, "documentIds must be an array");
    const unique = [...new Set(ids.map(Number))];
    for (const id of unique) {
      if (!Number.isInteger(id) || !this.documents.get(userId, id)) throw new HttpError(400, `Unknown document ${id}`);
    }
    return unique;
  }
}

function sha256Hex(data: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

const titleCollator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

const itemTitle = (item: LibraryItem) =>
  item.type === "stack" ? item.stack.title : item.document.title.trim() || item.document.originalName;
const itemCreated = (item: LibraryItem) => (item.type === "stack" ? item.stack.createdAt : item.document.createdAt);
const itemUpdated = (item: LibraryItem) => (item.type === "stack" ? item.stack.updatedAt : item.document.updatedAt);
const itemKey = (item: LibraryItem) => `${item.type}:${item.type === "stack" ? item.stack.id : item.document.id}`;

/** Sorts library items; with "custom", arranged items come first in their order, then the rest by upload date (new ones last). */
export function sortLibrary(items: LibraryItem[], sort: LibrarySort, positions: Map<string, number>): LibraryItem[] {
  const byUpdated = (a: LibraryItem, b: LibraryItem) => itemUpdated(b).localeCompare(itemUpdated(a));
  const byCreatedAsc = (a: LibraryItem, b: LibraryItem) => itemCreated(a).localeCompare(itemCreated(b));
  const compare: Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number> = {
    updated: byUpdated,
    "created-desc": (a, b) => itemCreated(b).localeCompare(itemCreated(a)),
    "created-asc": byCreatedAsc,
    "title-asc": (a, b) => titleCollator.compare(itemTitle(a), itemTitle(b)),
    "title-desc": (a, b) => titleCollator.compare(itemTitle(b), itemTitle(a)),
    custom: (a, b) => {
      const pa = positions.get(itemKey(a)) ?? Infinity;
      const pb = positions.get(itemKey(b)) ?? Infinity;
      return pa === pb ? byCreatedAsc(a, b) : pa - pb;
    },
  };
  return [...items].sort(compare[sort]);
}
