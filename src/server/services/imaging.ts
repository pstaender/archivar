import { extname } from "node:path";
import { isBlackAndWhite, isDefaultEditSettings } from "../../shared/editSettings";
import { isEditableImageType, Jimp, type JimpImage } from "../../shared/image/jimp";
import { applyEdits, scaleToFit } from "../../shared/image/pipeline";
import { PREVIEW_SIZE } from "../../shared/preview";
import { drawShapes } from "../../shared/shapes";
import type { VectorArea } from "../../vectorizer";
import { blankVectorAreas, paintVectorAreas } from "../../vectorizer/server/paint";
import type { PdfQuality } from "../../shared/settings";
import type { DocumentKind, EditSettings } from "../../shared/types";
import { convertibleTypeForExtension } from "../../shared/uploads";
import type { StoredDocument } from "../db/documents";
import { derivedKeys, type FileStorage } from "../storage";
import type { ImageConverter } from "./magick";
import { inspectPdf, renderPdfPage } from "./pdf";
import { type PdfImage, preparePdfImage } from "./pdfImage";

export const THUMBNAIL_SIZE = 480;
const JPEG_QUALITY = 90;
// Compression artifacts in the editor's base image would show up in its threshold and contrast preview.
const PREVIEW_JPEG_QUALITY = 95;
const OCR_PDF_SCALE = 2.5;
const OCR_MAX_PDF_PAGES = 50;
// Tesseract reads text best at about 300 DPI. In 600 DPI scans the letters are so large that it splits lines and
// misreads most words, so images are reduced to A4 at 300 DPI first.
export const OCR_MAX_SIZE = 3508;

export interface OcrImage {
  data: Uint8Array;
  width: number;
  height: number;
}

async function fitForOcr(encoded: Uint8Array): Promise<OcrImage> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(Buffer.from(encoded));
  const scale = Math.min(1, OCR_MAX_SIZE / Math.max(image.width, image.height));
  if (scale === 1) return { data: encoded, width: image.width, height: image.height };
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return { data: await canvas.encode("png"), width, height };
}

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
    private vectorAreas: (doc: StoredDocument) => VectorArea[] = () => [],
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

  /** Storage key of the editor's base image; created on demand for documents uploaded with an older preview size. */
  async preview(doc: StoredDocument): Promise<string> {
    const key = derivedKeys.preview(doc.id);
    if (doc.kind === "image" && !(await this.storage.exists(key))) await this.writePreview(doc.id, await this.loadOriginal(doc));
    return key;
  }

  /** Deletes editor base images of other sizes (`preview.jpg` before sizes were versioned); returns how many. */
  async removeStalePreviews(): Promise<number> {
    const current = (key: string) => key === derivedKeys.preview(Number(key.split("/")[1]));
    const stale = (await this.storage.list(derivedKeys.anyPreview)).filter((key) => !current(key));
    for (const key of stale) await this.storage.delete(key);
    return stale.length;
  }

  private async writePreview(id: number, original: JimpImage): Promise<void> {
    await this.storage.write(derivedKeys.preview(id), await toJpeg(scaleToFit(original.clone() as JimpImage, PREVIEW_SIZE), PREVIEW_JPEG_QUALITY));
  }

  async renderJpeg(doc: StoredDocument, settings: EditSettings): Promise<Uint8Array<ArrayBuffer>> {
    const original = await this.loadOriginal(doc);
    return toJpeg(isDefaultEditSettings(settings) ? original : applyEdits(original, settings));
  }

  async renderDerivatives(doc: StoredDocument): Promise<{ width: number; height: number } | null> {
    if (doc.kind === "image") {
      const original = await this.loadOriginal(doc);
      if (!(await this.storage.exists(derivedKeys.preview(doc.id)))) await this.writePreview(doc.id, original);
      const edited = isDefaultEditSettings(doc.editSettings) ? original : applyEdits(original, doc.editSettings);
      const { width, height } = edited.bitmap;
      let processed = edited;
      if (doc.shapes.length > 0 || doc.vectorCount > 0) {
        await this.storage.write(derivedKeys.edited(doc.id), await toJpeg(edited));
        processed = edited.clone() as JimpImage;
        if (doc.vectorCount > 0) await paintVectorAreas(processed.bitmap, this.vectorAreas(doc));
        drawShapes(processed.bitmap, doc.shapes);
      } else if (await this.storage.exists(derivedKeys.edited(doc.id))) {
        await this.storage.delete(derivedKeys.edited(doc.id));
      }
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

  /** Storage key of the edited image without shapes and vector areas, which they are drawn on in the editor. */
  async editedKey(doc: StoredDocument): Promise<string> {
    if (doc.shapes.length === 0 && doc.vectorCount === 0) return derivedKeys.processed(doc.id);
    const key = derivedKeys.edited(doc.id);
    if (!(await this.storage.exists(key))) await this.renderDerivatives(doc);
    return key;
  }

  /** The edited image in full resolution. */
  async processedJpeg(doc: StoredDocument): Promise<Uint8Array> {
    const key = derivedKeys.processed(doc.id);
    if (!(await this.storage.exists(key))) await this.renderDerivatives(doc);
    return this.storage.read(key);
  }

  /**
   * The image for the PDF export in the requested quality. Vectorized areas are left blank (their background color),
   * as the PDF draws them as vectors on top, which also lets the image compress better; shapes are painted as usual.
   * "original" renders the edits again instead of starting from the stored JPEG, so the image has no compression loss.
   */
  async pdfImage(doc: StoredDocument, quality: PdfQuality): Promise<{ image: PdfImage; width: number; height: number; vectors: VectorArea[] }> {
    const vectors = doc.vectorCount > 0 ? this.vectorAreas(doc) : [];
    // Canvas instead of Jimp for the stored JPEGs: jpeg-js refuses to decode large scans with its default memory limit.
    const { createCanvas, ImageData, loadImage } = await import("@napi-rs/canvas");
    let canvas;
    let painted = false;
    if (quality === "original") {
      const original = await this.loadOriginal(doc);
      const { data, width, height } = (isDefaultEditSettings(doc.editSettings) ? original : applyEdits(original, doc.editSettings)).bitmap;
      canvas = createCanvas(width, height);
      canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height), 0, 0);
    } else {
      painted = vectors.length === 0;
      const encoded = painted ? await this.processedJpeg(doc) : await this.storage.read(await this.editedKey(doc));
      const image = await loadImage(Buffer.from(encoded));
      canvas = createCanvas(image.width, image.height);
      canvas.getContext("2d").drawImage(image, 0, 0);
    }
    const { width, height } = canvas;
    const ctx = canvas.getContext("2d");
    if (!painted) {
      blankVectorAreas(ctx, vectors, width, height);
      for (const shape of doc.shapes) {
        ctx.fillStyle = shape.color;
        const x = Math.round(shape.x * width);
        const y = Math.round(shape.y * height);
        ctx.fillRect(x, y, Math.round((shape.x + shape.width) * width) - x, Math.round((shape.y + shape.height) * height) - y);
      }
    }
    return { image: await preparePdfImage(canvas, quality, isBlackAndWhite(doc.editSettings)), width, height, vectors };
  }

  async ocrImages(doc: StoredDocument): Promise<OcrImage[]> {
    if (doc.kind === "image") return [await fitForOcr(await this.processedJpeg(doc))];
    if (doc.kind === "pdf") {
      const data = await this.storage.read(doc.storageKey);
      const pages = Math.min(doc.pageCount ?? 1, OCR_MAX_PDF_PAGES);
      const images: OcrImage[] = [];
      for (let page = 1; page <= pages; page++) images.push(await fitForOcr(await renderPdfPage(data, page, OCR_PDF_SCALE)));
      return images;
    }
    return [];
  }
}
