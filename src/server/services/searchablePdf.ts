import {
  beginText,
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
import type { OcrLayout } from "../db/documents";

// The page gets A4's long side; the image keeps its aspect ratio.
const PAGE_LONG_SIDE = 842;
// Tesseract's line boxes reach from ascenders to descenders.
const FONT_SIZE_OF_BOX = 0.8;
const BASELINE_OF_BOX = 0.22;
const FALLBACK_MARGIN = 0.05;
const FALLBACK_MAX_LINE = 0.04;

type Box = OcrLayout["lines"][number]["box"];

/**
 * A PDF with the image as the page and the text as an invisible layer on top, so it can be searched and copied.
 * The text goes onto the recognized line positions when its lines still match them (same number of lines, e.g. after
 * fixing typos); otherwise it is spread evenly over the page.
 */
export async function createSearchablePdf(jpeg: Uint8Array, text: string, layout: OcrLayout | null, title: string): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("archivar");
  const image = await pdf.embedJpg(jpeg);
  const scale = PAGE_LONG_SIDE / Math.max(image.width, image.height);
  const page = pdf.addPage([image.width * scale, image.height * scale]);
  page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = text
    .split("\n")
    .map((line) => toWinAnsi(line.trim(), font))
    .filter(Boolean);
  const matches = layout?.lines.length === lines.length;
  const boxes = matches ? layout.lines.map((line) => line.box) : evenBoxes(lines.length);
  lines.forEach((line, i) => drawInvisibleLine(page, font, line, boxes[i]!, matches));
  return new Uint8Array(await pdf.save());
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
