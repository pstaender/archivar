import type { DocumentRepository } from "../db/documents";
import type { ImagingService } from "./imaging";

export interface OcrResult {
  text: string;
  confidence: number;
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
    const { data } = await worker.recognize(Buffer.from(image));
    return { text: data.text.trim(), confidence: data.confidence };
  }

  async terminate(): Promise<void> {
    if (!this.worker) return;
    const worker = await this.worker;
    this.worker = null;
    await worker.terminate();
  }
}

export class OcrQueue {
  private queue: number[] = [];
  private running: Promise<void> | null = null;

  constructor(
    private documents: DocumentRepository,
    private imaging: ImagingService,
    private engine: OcrEngine,
  ) {}

  enqueue(documentId: number): void {
    if (this.queue.includes(documentId)) return;
    this.documents.setOcrResult(documentId, { status: "pending" });
    this.queue.push(documentId);
    this.running ??= this.drain().finally(() => {
      this.running = null;
    });
  }

  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    await Promise.resolve();
    let id: number | undefined;
    while ((id = this.queue.shift()) !== undefined) await this.process(id);
  }

  private async process(documentId: number): Promise<void> {
    const doc = this.documents.getById(documentId);
    if (!doc) return;
    this.documents.setOcrResult(documentId, { status: "running" });
    try {
      const images = await this.imaging.ocrImages(doc);
      if (images.length === 0) throw new Error("Document type does not support OCR");
      const results: OcrResult[] = [];
      for (const image of images) results.push(await this.engine.recognize(image));
      const text = results.map((r) => r.text).join("\n\n").trim();
      const confidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
      this.documents.setOcrResult(documentId, { status: "done", text, confidence, error: null });
    } catch (error) {
      this.documents.setOcrResult(documentId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
