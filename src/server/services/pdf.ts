import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

const canvasImport = () => import("@napi-rs/canvas");

export interface PdfInfo {
  pageCount: number;
  text: string;
}

// pdf.js transfers (detaches) the buffer it receives, so every call gets its own copy.
export async function inspectPdf(data: Uint8Array): Promise<PdfInfo> {
  const pdf = await getDocumentProxy(data.slice());
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  await pdf.cleanup();
  return { pageCount: totalPages, text: text.trim() };
}

export async function renderPdfPage(data: Uint8Array, pageNumber: number, scale: number): Promise<Uint8Array> {
  const png = await renderPageAsImage(data.slice(), pageNumber, { canvasImport, scale });
  return new Uint8Array(png);
}
