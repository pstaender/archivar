import type { DocumentRepository } from "../db/documents";
import type { ImagingService } from "./imaging";
import { filterOcrText, type OcrParagraph } from "./ocrFilter";

export interface OcrResult {
  text: string;
  confidence: number;
  paragraphs?: OcrParagraph[];
}

export interface OcrOptions {
  allText?: boolean;
}

export interface OcrEngine {
  recognize(image: Uint8Array): Promise<OcrResult>;
  terminate(): Promise<void>;
}

type TesseractWorker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;

export class TesseractEngine implements OcrEngine {
  private worker: Promise<TesseractWorker> | null = null;

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
          words: line.words.map((word) => ({ text: word.text, confidence: word.confidence })),
        })),
      ),
    );
    return { text: data.text.trim(), confidence: data.confidence, paragraphs };
  }

  async terminate(): Promise<void> {
    if (!this.worker) return;
    const worker = await this.worker;
    this.worker = null;
    await worker.terminate();
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
      const texts = results.map((result) => {
        if (options.allText || !result.paragraphs) return result.text;
        const filtered = filterOcrText(result.paragraphs);
        removed += filtered.removed;
        return filtered.removed > 0 ? filtered.text : result.text;
      });
      const text = texts.join("\n\n").trim();
      const confidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
      this.documents.setOcrResult(documentId, { status: "done", text, confidence, error: null, removed });
    } catch (error) {
      this.documents.setOcrResult(documentId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
