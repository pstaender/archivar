import {
  beginText,
  concatTransformationMatrix,
  drawObject,
  endText,
  type PDFFont,
  PDFDocument,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  StandardFonts,
  TextRenderingMode,
} from "pdf-lib";
import type { Shape } from "../../shared/shapes";
import type { VectorArea } from "../../vectorizer";
import { pdfColor, vectorAreasPdfOperators } from "../../vectorizer/server/pdf";
import type { OcrLayout } from "../db/documents";
import { HttpError } from "../http";
import type { PdfImage } from "./pdfImage";

// The page gets A4's long side; the image keeps its aspect ratio.
const PAGE_LONG_SIDE = 842;
// Tesseract's line boxes reach from ascenders to descenders.
const FONT_SIZE_OF_BOX = 0.8;
const BASELINE_OF_BOX = 0.22;
const FALLBACK_MARGIN = 0.05;
const FALLBACK_MAX_LINE = 0.04;

type Box = OcrLayout["lines"][number]["box"];

/** Vector areas drawn as vectors over the image (`width` × `height` pixels), with the shapes on top of them. */
export interface PdfOverlay {
  width: number;
  height: number;
  vectors: VectorArea[];
  shapes: Shape[];
}

export type PdfPart =
  | { kind: "image"; image: PdfImage; text: string; layout: OcrLayout | null; overlay?: PdfOverlay | null }
  /** An uploaded PDF; all its pages are copied as they are. */
  | { kind: "pdf"; name: string; data: Uint8Array };

/**
 * One PDF from images and PDFs in order. Each image becomes a page with its text as an invisible layer on top, so it
 * can be searched and copied. The text goes onto the recognized line positions when its lines still match them (same
 * number of lines, e.g. after fixing typos); otherwise it is spread evenly over the page.
 */
export async function createSearchablePdf(parts: PdfPart[], title: string): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("archivar");
  let font: PDFFont | null = null;
  for (const part of parts) {
    if (part.kind === "image") {
      font ??= await pdf.embedFont(StandardFonts.Helvetica);
      await addImagePage(pdf, font, part);
    } else {
      await appendPdf(pdf, part);
    }
  }
  return new Uint8Array(await pdf.save());
}

async function appendPdf(pdf: PDFDocument, { name, data }: Extract<PdfPart, { kind: "pdf" }>) {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(data, { ignoreEncryption: true });
  } catch {
    throw new HttpError(422, `"${name}" could not be read as a PDF`);
  }
  for (const page of await pdf.copyPages(source, source.getPageIndices())) pdf.addPage(page);
}

async function addImagePage(pdf: PDFDocument, font: PDFFont, { image, text, layout, overlay }: Extract<PdfPart, { kind: "image" }>) {
  const page = image.kind === "bilevel" ? addBilevelPage(pdf, image) : await addEncodedPage(pdf, image);
  if (overlay) drawOverlay(pdf, page, overlay);

  const lines = text
    .split("\n")
    .map((line) => toWinAnsi(line.trim(), font))
    .filter(Boolean);
  const matches = layout?.lines.length === lines.length;
  const boxes = matches ? layout.lines.map((line) => line.box) : evenBoxes(lines.length);
  lines.forEach((line, i) => drawInvisibleLine(page, font, line, boxes[i]!, matches));
}

function pageFor(pdf: PDFDocument, width: number, height: number): PDFPage {
  const scale = PAGE_LONG_SIDE / Math.max(width, height);
  return pdf.addPage([width * scale, height * scale]);
}

async function addEncodedPage(pdf: PDFDocument, { kind, data }: Extract<PdfImage, { kind: "jpeg" | "png" }>): Promise<PDFPage> {
  const image = kind === "jpeg" ? await pdf.embedJpg(data) : await pdf.embedPng(data);
  const page = pageFor(pdf, image.width, image.height);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return page;
}

// pdf-lib can only embed 8-bit images, so the 1-bit image XObject is written directly.
function addBilevelPage(pdf: PDFDocument, { width, height, data }: Extract<PdfImage, { kind: "bilevel" }>): PDFPage {
  const stream = pdf.context.stream(data, {
    Type: "XObject",
    Subtype: "Image",
    Width: width,
    Height: height,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 1,
    Filter: "FlateDecode",
  });
  const page = pageFor(pdf, width, height);
  const name = page.node.newXObject("Image", pdf.context.register(stream));
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(page.getWidth(), 0, 0, page.getHeight(), 0, 0), drawObject(name), popGraphicsState());
  return page;
}

function drawOverlay(pdf: PDFDocument, page: PDFPage, { width, height, vectors, shapes }: PdfOverlay) {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  // The image has the shapes painted in already, but the vectors would cover those that overlap them.
  const rects = shapes.map(
    (s) => `q ${pdfColor(s.color)} rg ${s.x * pageWidth} ${(1 - s.y - s.height) * pageHeight} ${s.width * pageWidth} ${s.height * pageHeight} re f Q`,
  );
  const content = [vectorAreasPdfOperators(vectors, width, height, pageWidth, pageHeight), ...rects].join("\n");
  page.node.addContentStream(pdf.context.register(pdf.context.flateStream(content)));
}

function evenBoxes(count: number): Box[] {
  const height = Math.min(FALLBACK_MAX_LINE, (1 - 2 * FALLBACK_MARGIN) / Math.max(1, count));
  return Array.from({ length: count }, (_, i) => {
    const top = FALLBACK_MARGIN + i * height;
    return [FALLBACK_MARGIN, top, 1 - FALLBACK_MARGIN, top + height];
  });
}

/** Squeezes the text to the box width; `stretch` also widens it (only sensible for real line positions). */
function drawInvisibleLine(page: PDFPage, font: PDFFont, text: string, [x0, y0, x1, y1]: Box, stretch: boolean) {
  const width = page.getWidth();
  const height = page.getHeight();
  const boxHeight = (y1 - y0) * height;
  const size = Math.max(1, boxHeight * FONT_SIZE_OF_BOX);
  const textWidth = font.widthOfTextAtSize(text, size);
  if (textWidth <= 0) return;
  const squeeze = (100 * (x1 - x0) * width) / textWidth;
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    setFontAndSize(fontKey, size),
    setCharacterSqueeze(stretch ? squeeze : Math.min(100, squeeze)),
    setTextMatrix(1, 0, 0, 1, x0 * width, height - y1 * height + boxHeight * BASELINE_OF_BOX),
    showText(font.encodeText(text)),
    endText(),
    popGraphicsState(),
  );
}

/** Helvetica only covers Windows-1252; other characters lose their accents or become "?". */
function toWinAnsi(text: string, font: PDFFont): string {
  const supported = new Set(font.getCharacterSet());
  return [...text]
    .map((char) => {
      if (supported.has(char.codePointAt(0)!)) return char;
      const base = char.normalize("NFKD").replace(/\p{M}/gu, "");
      return [...base].every((c) => supported.has(c.codePointAt(0)!)) && base ? base : "?";
    })
    .join("");
}
