import type { Rotation } from "../../shared/types";
import type { DocumentRepository, OcrLayout, StoredDocument } from "../db/documents";
import type { ImagingService } from "./imaging";
import { detectLanguage } from "./language";
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
  /** Languages used when `recognize` gets none. */
  readonly languages: string[];
  recognize(image: Uint8Array, languages?: string[]): Promise<OcrResult>;
  detectOrientation(image: Uint8Array): Promise<Orientation | null>;
  terminate(): Promise<void>;
}

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;

export class TesseractEngine implements OcrEngine {
  private worker: Promise<TesseractWorker> | null = null;
  private workerLanguages = "";
  private osdWorker: Promise<TesseractWorker> | null = null;

  constructor(
    readonly languages: string[],
    private cachePath: string,
  ) {}

  private getWorker(): Promise<TesseractWorker> {
    this.workerLanguages = this.languages.join("+");
    this.worker ??= import("tesseract.js").then(({ createWorker }) =>
      createWorker(this.languages, undefined, { cachePath: this.cachePath }),
    );
    return this.worker;
  }

  /** The worker with `languages` loaded; their data is downloaded into the cache on first use. */
  private async workerFor(languages: string[]): Promise<TesseractWorker> {
    if (!this.worker) await this.getWorker();
    const worker = await this.worker!;
    const key = languages.join("+");
    if (key !== this.workerLanguages) {
      await worker.reinitialize(key);
      this.workerLanguages = key;
    }
    return worker;
  }

  async recognize(image: Uint8Array, languages = this.languages): Promise<OcrResult> {
    const worker = await this.workerFor(languages);
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
    this.workerLanguages = "";
    this.osdWorker = null;
    for (const worker of workers) await (await worker).terminate();
  }
}

// Recognizing one image or PDF page normally takes seconds; a worker that hangs must not block the queue forever.
export const OCR_PAGE_TIMEOUT_MS = 3 * 60_000;
export const OCR_TIMEOUT_MESSAGE = "Die Texterkennung hat zu lange gedauert und wurde abgebrochen.";

class OcrTimeoutError extends Error {}

export class OcrQueue {
  private queue: { id: number; options: OcrOptions }[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private documents: DocumentRepository,
    private imaging: ImagingService,
    private engine: OcrEngine,
    private pageTimeoutMs = OCR_PAGE_TIMEOUT_MS,
  ) {}

  /** Queues documents left pending or running by a previous server process (the queue only lives in memory). */
  resume(): number {
    const ids = this.documents.unfinishedOcrIds();
    for (const id of ids) this.enqueue(id);
    return ids.length;
  }

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
      for (const image of images) results.push(await this.recognize(image, doc.ocrLanguages ?? undefined));
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
      this.documents.setOcrResult(documentId, { status: "done", text, confidence, error: null, removed, language: detectLanguage(text) });
      this.documents.setOcrLayout(documentId, doc.kind === "image" ? toLayout(doc, lines[0] ?? []) : null);
    } catch (error) {
      this.documents.setOcrResult(documentId, {
        status: "failed",
        error: error instanceof OcrTimeoutError ? OCR_TIMEOUT_MESSAGE : error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async recognize(image: Uint8Array, languages?: string[]): Promise<OcrResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new OcrTimeoutError()), this.pageTimeoutMs);
    });
    try {
      return await Promise.race([this.engine.recognize(image, languages), timeout]);
    } catch (error) {
      // The worker may be stuck; a fresh one is started for the next job.
      // Not awaited: stopping a worker that hangs while starting would hang as well.
      if (error instanceof OcrTimeoutError) void this.engine.terminate().catch((e) => console.warn("Could not stop the OCR worker:", e));
      throw error;
    } finally {
      clearTimeout(timer);
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
