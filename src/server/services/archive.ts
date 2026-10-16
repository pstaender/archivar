import { basename, extname } from "node:path";
import { isDefaultEditSettings, normalizeEditSettings } from "../../shared/editSettings";
import { autoBwVariants } from "../../shared/image/autoBw";
import type { JimpImage } from "../../shared/image/jimp";
import { normalizeFolderPath } from "../../shared/folders";
import type {
  ArchiveDocument,
  BwVariant,
  DewarpGrid,
  DocumentUpdate,
  EditSettings,
  LibraryItem,
  LibraryQuery,
  Rotation,
  Stack,
  StackCreate,
  StackUpdate,
  StackWithDocuments,
} from "../../shared/types";
import { type DocumentRepository, type StoredDocument, toPublicDocument } from "../db/documents";
import type { FolderRepository } from "../db/folders";
import type { StackRepository } from "../db/stacks";
import { HttpError } from "../http";
import { derivedKeys, type FileStorage } from "../storage";
import { extensionFor, type ImagingService } from "./imaging";
import { type DewarpEngine, toDewarpGrid } from "./dewarp";
import type { OcrOptions, OcrQueue } from "./ocr";

export interface UploadOptions {
  folders?: string[];
  stackId?: number;
  runOcr?: boolean;
  ocrAllText?: boolean;
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
  ) {}

  library(userId: number, query: LibraryQuery): LibraryItem[] {
    const filter = { folder: query.folder ? normalizeFolderPath(query.folder) : undefined, q: query.q?.trim() || undefined };
    const items: (LibraryItem & { sortKey: string })[] = [
      ...this.stacks.list(userId, filter).map((stack) => ({ type: "stack" as const, stack, sortKey: stack.updatedAt })),
      ...this.documents.list(userId, { ...filter, stackId: null }).map((doc) => ({
        type: "document" as const,
        document: toPublicDocument(doc),
        sortKey: doc.updatedAt,
      })),
    ];
    items.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return items.map(({ sortKey: _sortKey, ...item }) => item as LibraryItem);
  }

  getDocument(userId: number, id: number): StoredDocument {
    const doc = this.documents.get(userId, id);
    if (!doc) throw new HttpError(404, "Document not found");
    return doc;
  }

  async upload(userId: number, files: UploadFile[], options: UploadOptions = {}): Promise<ArchiveDocument[]> {
    if (files.length === 0) throw new HttpError(400, "No files uploaded");
    if (options.stackId !== undefined) this.getStack(userId, options.stackId);

    const created: StoredDocument[] = [];
    for (const file of files) {
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
        width: inspection.width,
        height: inspection.height,
        pageCount: inspection.pageCount,
        ocrText: inspection.text,
        ocrStatus: hasEmbeddedText ? "done" : "none",
        metadata: hasEmbeddedText ? { ...inspection.metadata, textSource: "pdf" } : inspection.metadata,
      });
      if (options.folders?.length) this.folders.setForDocument(userId, doc.id, options.folders);
      if (options.runOcr && doc.kind === "image") doc = await this.autoEnhance(doc);
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
        if (doc.kind !== "file" && doc.ocrStatus !== "done") this.ocr.enqueue(doc.id, { allText: options.ocrAllText });
      }
    }

    return created.map((doc) => toPublicDocument(this.documents.get(userId, doc.id)!));
  }

  async updateDocument(userId: number, id: number, update: DocumentUpdate): Promise<ArchiveDocument> {
    const doc = this.getDocument(userId, id);
    const fields: Parameters<DocumentRepository["update"]>[2] = {};
    if (typeof update.title === "string") fields.title = update.title.trim();
    if (typeof update.ocrText === "string") fields.ocrText = update.ocrText;
    if (update.editSettings !== undefined) {
      if (doc.kind !== "image") throw new HttpError(400, "Only images can be edited");
      fields.editSettings = normalizeEditSettings(update.editSettings, doc.editSettings);
    }
    if (Array.isArray(update.folders)) this.folders.setForDocument(userId, id, update.folders.map(String));

    let updated = this.documents.update(userId, id, fields)!;
    if (fields.editSettings) {
      const size = await this.imaging.renderDerivatives(updated);
      if (size) updated = this.documents.update(userId, id, size)!;
    }
    if (updated.stackId !== null) this.stacks.touch(updated.stackId);
    return toPublicDocument(updated);
  }

  async deleteDocument(userId: number, id: number): Promise<void> {
    const doc = this.getDocument(userId, id);
    this.documents.delete(userId, id);
    if (doc.stackId !== null) this.stacks.deleteIfEmpty(doc.stackId);
    await this.storage.delete(doc.storageKey);
    await this.storage.delete(derivedKeys.dir(id));
  }

  requestOcr(userId: number, id: number, options: OcrOptions = {}): ArchiveDocument {
    const doc = this.getDocument(userId, id);
    if (doc.kind === "file") throw new HttpError(400, "OCR is only available for images and PDFs");
    this.ocr.enqueue(id, options);
    return toPublicDocument(this.documents.get(userId, id)!);
  }

  async detectDewarp(userId: number, id: number, rotation: Rotation): Promise<DewarpGrid> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be dewarped");
    if (!this.dewarp.available()) throw new HttpError(503, "Dewarping model is not installed");
    let image = await this.imaging.loadOriginal(doc);
    if (rotation !== 0) image = image.rotate(-rotation) as JimpImage;
    return toDewarpGrid(await this.dewarp.predict(image.bitmap), rotation);
  }

  async autoBw(userId: number, id: number, settings: Partial<EditSettings> = {}): Promise<BwVariant[]> {
    const doc = this.getDocument(userId, id);
    if (doc.kind !== "image") throw new HttpError(400, "Only images can be edited");
    return autoBwVariants(await this.imaging.loadOriginal(doc), normalizeEditSettings(settings, doc.editSettings));
  }

  private async autoEnhance(doc: StoredDocument): Promise<StoredDocument> {
    try {
      const image = await this.imaging.loadOriginal(doc);
      let settings = doc.editSettings;
      if (this.dewarp.available()) settings = { ...settings, dewarp: toDewarpGrid(await this.dewarp.predict(image.bitmap), settings.rotation) };
      const [best] = autoBwVariants(image, settings);
      if (best) settings = { ...settings, ...best, colorMode: "bw" };
      return this.documents.update(doc.userId, doc.id, { editSettings: normalizeEditSettings(settings) }) ?? doc;
    } catch (error) {
      console.warn(`Automatic enhancement failed for document ${doc.id}:`, error);
      return doc;
    }
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
