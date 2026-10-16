import type { Rotation } from "../../shared/types";
import type { DocumentRepository, OcrLayout, StoredDocument } from "../db/documents";
import type { ImagingService } from "./imaging";
import { allOcrLines, filterOcrText, type OcrParagraph, type OcrTextLine } from "./ocrFilter";

export interface OcrResult {
  text: string;
  confidence: number;
  paragraphs?: OcrParagraph[];
}

export interface OcrOptions {
  allText?: boolean;
}

export interface Orientation {
  /** Clockwise rotation that turns the text upright. */
  rotation: Rotation;
  confidence: number;
}

export interface OcrEngine {
  recognize(image: Uint8Array): Promise<OcrResult>;
  detectOrientation(image: Uint8Array): Promise<Orientation | null>;
  terminate(): Promise<void>;
}

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;

export class TesseractEngine implements OcrEngine {
  private worker: Promise<TesseractWorker> | null = null;
  private osdWorker: Promise<TesseractWorker> | null = null;

  constructor(
    private languages: string[],
    private cachePath: string,
  ) {}

  private getWorker(): Promise<TesseractWorker> {
    this.worker ??= import("tesseract.js").then(({ createWorker }) =>
      createWorker(this.languages, undefined, { cachePath: this.cachePath }),
    );
    return this.worker;
  }

  async recognize(image: Uint8Array): Promise<OcrResult> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(Buffer.from(image), {}, { text: true, blocks: true });
    const paragraphs = (data.blocks ?? []).flatMap((block) =>
      block.paragraphs.map((paragraph) =>
        paragraph.lines.map((line) => ({
          confidence: line.confidence,
          bbox: line.bbox,
          words: line.words.map((word) => ({ text: word.text, confidence: word.confidence })),
        })),
      ),
    );
    return { text: data.text.trim(), confidence: data.confidence, paragraphs };
  }

  // Orientation detection only exists in the legacy engine, so it gets its own worker with the osd model.
  private getOsdWorker(): Promise<TesseractWorker> {
    this.osdWorker ??= import("tesseract.js").then(({ createWorker, OEM }) =>
      createWorker("osd", OEM.TESSERACT_ONLY, { cachePath: this.cachePath, legacyCore: true, legacyLang: true }),
    );
    return this.osdWorker;
  }

  async detectOrientation(image: Uint8Array): Promise<Orientation | null> {
    const worker = await this.getOsdWorker();
    const { data } = await worker.detect(Buffer.from(image));
    const degrees = data.orientation_degrees;
    if (degrees !== 0 && degrees !== 90 && degrees !== 180 && degrees !== 270) return null;
    return { rotation: degrees, confidence: data.orientation_confidence ?? 0 };
  }

  async terminate(): Promise<void> {
    const workers = [this.worker, this.osdWorker].filter((w) => w !== null);
    this.worker = null;
    this.osdWorker = null;
    for (const worker of workers) await (await worker).terminate();
  }
}

export class OcrQueue {
  private queue: { id: number; options: OcrOptions }[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private documents: DocumentRepository,
    private imaging: ImagingService,
    private engine: OcrEngine,
  ) {}

  enqueue(documentId: number, options: OcrOptions = {}): void {
    const queued = this.queue.find((job) => job.id === documentId);
    if (queued) {
      queued.options = options;
      return;
    }
    this.documents.setOcrResult(documentId, { status: "pending" });
    this.queue.push({ id: documentId, options });
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await Promise.resolve();
    let job: { id: number; options: OcrOptions } | undefined;
    while ((job = this.queue.shift()) !== undefined) await this.process(job.id, job.options);
  }

  private async process(documentId: number, options: OcrOptions): Promise<void> {
    const doc = this.documents.getById(documentId);
    if (!doc) return;
    this.documents.setOcrResult(documentId, { status: "running" });
    try {
      const images = await this.imaging.ocrImages(doc);
      if (images.length === 0) throw new Error("Document type does not support OCR");
      const results: OcrResult[] = [];
      for (const image of images) results.push(await this.engine.recognize(image));
      let removed = 0;
      const lines: OcrTextLine[][] = [];
      const texts = results.map((result) => {
        if (options.allText || !result.paragraphs) {
          lines.push(allOcrLines(result.paragraphs ?? []));
          return result.text;
        }
        const filtered = filterOcrText(result.paragraphs);
        removed += filtered.removed;
        lines.push(filtered.removed > 0 ? filtered.lines : allOcrLines(result.paragraphs));
        return filtered.removed > 0 ? filtered.text : result.text;
      });
      const text = texts.join("\n\n").trim();
      const confidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
      this.documents.setOcrResult(documentId, { status: "done", text, confidence, error: null, removed });
      this.documents.setOcrLayout(documentId, doc.kind === "image" ? toLayout(doc, lines[0] ?? []) : null);
    } catch (error) {
      this.documents.setOcrResult(documentId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function toLayout(doc: StoredDocument, lines: OcrTextLine[]): OcrLayout | null {
  const { width, height } = doc;
  if (!width || !height || lines.some((line) => !line.bbox)) return null;
  return {
    editSettings: doc.editSettings,
    lines: lines.map(({ text, bbox }) => ({ text, box: [bbox!.x0 / width, bbox!.y0 / height, bbox!.x1 / width, bbox!.y1 / height] })),
  };
}
