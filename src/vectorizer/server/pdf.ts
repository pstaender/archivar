import { areaPixels } from "../areas";
import type { VectorArea } from "../types";

const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
const OPERATOR: Record<string, string> = { M: "m", L: "l", C: "c", Z: "h" };
const TOKEN = /[MLCZ]|-?(?:\d+\.?\d*|\.\d+)/g;
// Coordinates are rounded to steps of at most this size on the page (in pt), which keeps large graphics smaller.
const MAX_STEP = 0.25;

const num = (n: number) => String(Math.round(n * 10000) / 10000);

export function pdfColor(hex: string): string {
  return [1, 3, 5].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(" ");
}

/** SVG path data of the vectorizer (absolute M/L/C/Z) as PDF path operators, with coordinates rounded to `digits`. */
export function pathOperators(d: string, digits = 2): string {
  const factor = 10 ** digits;
  const out: string[] = [];
  let command = "";
  let args: string[] = [];
  for (const token of d.match(TOKEN) ?? []) {
    if (token in ARITY) {
      command = token;
      args = [];
      if (command === "Z") out.push("h");
      continue;
    }
    args.push(String(Math.round(Number(token) * factor) / factor));
    if (args.length === ARITY[command]) {
      out.push(`${args.join(" ")} ${OPERATOR[command]}`);
      // Further coordinate pairs after M are line segments, as in SVG.
      if (command === "M") command = "L";
      args = [];
    }
  }
  return out.join("\n");
}

/**
 * PDF content operators that draw the vectorized areas onto a page showing an image of `imageWidth` × `imageHeight`
 * pixels: each graphic is clipped to the pixel rectangle the server paints it into, so it lines up with the raster.
 */
export function vectorAreasPdfOperators(areas: VectorArea[], imageWidth: number, imageHeight: number, pageWidth: number, pageHeight: number): string {
  const sx = pageWidth / imageWidth;
  const sy = pageHeight / imageHeight;
  const out: string[] = [];
  for (const { graphic, ...area } of areas) {
    if (!graphic) continue;
    const rect = areaPixels(area, imageWidth, imageHeight);
    if (rect.width === 0 || rect.height === 0) continue;
    const a = (rect.width / graphic.width) * sx;
    const d = -(rect.height / graphic.height) * sy;
    const digits = Math.min(2, Math.max(0, Math.ceil(Math.log10(Math.max(a, -d) / MAX_STEP))));
    out.push(
      "q",
      `${num(a)} 0 0 ${num(d)} ${num(rect.left * sx)} ${num(pageHeight - rect.top * sy)} cm`,
      `0 0 ${graphic.width} ${graphic.height} re W n`,
      `${pdfColor(graphic.background)} rg`,
      `0 0 ${graphic.width} ${graphic.height} re f`,
    );
    for (const path of graphic.paths) out.push(`${pdfColor(path.fill)} rg`, pathOperators(path.d, digits), "f");
    out.push("Q");
  }
  return out.join("\n");
}
