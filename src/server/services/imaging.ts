import { extname } from "node:path";
import { isDefaultEditSettings } from "../../shared/editSettings";
import { isEditableImageType, Jimp, type JimpImage } from "../../shared/image/jimp";
import { applyEdits, scaleToFit } from "../../shared/image/pipeline";
import type { DocumentKind, EditSettings } from "../../shared/types";
import { convertibleTypeForExtension } from "../../shared/uploads";
import type { StoredDocument } from "../db/documents";
import { derivedKeys, type FileStorage } from "../storage";
import type { ImageConverter } from "./magick";
import { inspectPdf, renderPdfPage } from "./pdf";

export const PREVIEW_SIZE = 2048;
export const THUMBNAIL_SIZE = 480;
const JPEG_QUALITY = 90;
const OCR_PDF_SCALE = 2.5;
const OCR_MAX_PDF_PAGES = 50;

export interface UploadInspection {
  kind: DocumentKind;
  mimeType: string;
  width: number | null;
  height: number | null;
  pageCount: number | null;
  text: string;
  metadata: Record<string, unknown>;
}

export function detectMimeType(name: string, declared: string): string {
  const type = declared.split(";")[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream") return type;
  return convertibleTypeForExtension(name) ?? Bun.file(name).type.split(";")[0]!;
}

export function extensionFor(name: string, mimeType: string): string {
  const ext = extname(name).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  return mimeType === "application/pdf" ? ".pdf" : mimeType.startsWith("image/") ? `.${mimeType.slice(6)}` : ".bin";
}

async function toJpeg(image: JimpImage, quality = JPEG_QUALITY): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await image.getBuffer("image/jpeg", { quality }));
}

export class ImagingService {
  constructor(
    private storage: FileStorage,
    private converter: ImageConverter | null = null,
  ) {}

  convertibleTypes(): string[] {
    return this.converter?.types() ?? [];
  }

  kindForMimeType(mimeType: string): DocumentKind {
    if (isEditableImageType(mimeType) || this.convertibleTypes().includes(mimeType)) return "image";
    if (mimeType === "application/pdf") return "pdf";
    return "file";
  }

  private async decode(data: Uint8Array, mimeType: string): Promise<JimpImage> {
    if (isEditableImageType(mimeType) || !this.converter) return (await Jimp.read(Buffer.from(data))) as JimpImage;
    return (await Jimp.read(Buffer.from(await this.converter.toPng(data, mimeType)))) as JimpImage;
  }

  async inspect(data: Uint8Array, name: string, declaredType: string): Promise<UploadInspection> {
    const mimeType = detectMimeType(name, declaredType);
    const kind = this.kindForMimeType(mimeType);
    const base: UploadInspection = { kind, mimeType, width: null, height: null, pageCount: null, text: "", metadata: {} };

    if (kind === "image") {
      try {
        const image = await this.decode(data, mimeType);
        const { width, height } = image.bitmap;
        return { ...base, width, height, metadata: { originalWidth: width, originalHeight: height } };
      } catch (error) {
        return { ...base, kind: "file", metadata: { decodeError: String(error) } };
      }
    }
    if (kind === "pdf") {
      try {
        const { pageCount, text } = await inspectPdf(data);
        return { ...base, pageCount, text };
      } catch (error) {
        return { ...base, kind: "file", metadata: { decodeError: String(error) } };
      }
    }
    return base;
  }

  async loadOriginal(doc: StoredDocument): Promise<JimpImage> {
    if (isEditableImageType(doc.mimeType)) return (await Jimp.read(Buffer.from(await this.storage.read(doc.storageKey)))) as JimpImage;
    // Converting with ImageMagick is slow, so the decoded original is kept next to the other derived files.
    const key = derivedKeys.source(doc.id);
    if (await this.storage.exists(key)) return (await Jimp.read(Buffer.from(await this.storage.read(key)))) as JimpImage;
    const image = await this.decode(await this.storage.read(doc.storageKey), doc.mimeType);
    await this.storage.write(key, new Uint8Array(await image.getBuffer("image/png")));
    return image;
  }

  async createPreview(doc: StoredDocument): Promise<void> {
    if (doc.kind === "image") {
      const original = await this.loadOriginal(doc);
      await this.storage.write(derivedKeys.preview(doc.id), await toJpeg(scaleToFit(original, PREVIEW_SIZE)));
    }
  }

  async renderJpeg(doc: StoredDocument, settings: EditSettings): Promise<Uint8Array<ArrayBuffer>> {
    const original = await this.loadOriginal(doc);
    return toJpeg(isDefaultEditSettings(settings) ? original : applyEdits(original, settings));
  }

  async renderDerivatives(doc: StoredDocument): Promise<{ width: number; height: number } | null> {
    if (doc.kind === "image") {
      const original = await this.loadOriginal(doc);
      if (!(await this.storage.exists(derivedKeys.preview(doc.id)))) {
        await this.storage.write(derivedKeys.preview(doc.id), await toJpeg(scaleToFit(original.clone() as JimpImage, PREVIEW_SIZE)));
      }
      const processed = isDefaultEditSettings(doc.editSettings) ? original : applyEdits(original, doc.editSettings);
      const { width, height } = processed.bitmap;
      await this.storage.write(derivedKeys.processed(doc.id), await toJpeg(processed));
      await this.storage.write(derivedKeys.thumbnail(doc.id), await toJpeg(scaleToFit(processed, THUMBNAIL_SIZE), 80));
      return { width, height };
    }
    if (doc.kind === "pdf") {
      try {
        const png = await renderPdfPage(await this.storage.read(doc.storageKey), 1, 1);
        const page = (await Jimp.read(Buffer.from(png))) as JimpImage;
        await this.storage.write(derivedKeys.thumbnail(doc.id), await toJpeg(scaleToFit(page, THUMBNAIL_SIZE), 80));
      } catch (error) {
        console.warn(`Could not render PDF thumbnail for document ${doc.id}:`, error);
      }
    }
    return null;
  }

  async ocrImages(doc: StoredDocument): Promise<Uint8Array[]> {
    if (doc.kind === "image") {
      const key = derivedKeys.processed(doc.id);
      if (!(await this.storage.exists(key))) await this.renderDerivatives(doc);
      return [await this.storage.read(key)];
    }
    if (doc.kind === "pdf") {
      const data = await this.storage.read(doc.storageKey);
      const pages = Math.min(doc.pageCount ?? 1, OCR_MAX_PDF_PAGES);
      const images: Uint8Array[] = [];
      for (let page = 1; page <= pages; page++) images.push(await renderPdfPage(data, page, OCR_PDF_SCALE));
      return images;
    }
    return [];
  }
}
