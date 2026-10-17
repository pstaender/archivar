/**
 * TypeScript port of VTracer (https://github.com/visioncortex/vtracer) with the parts of visioncortex and flo_curves
 * it needs: binary or hierarchical color clustering, stacked compositing (each layer traced on its own and painted
 * bottom to top), polygon or spline outlines and SVG path output. The mosaic compositing, watershed clustering,
 * palettes and the curve simplification pass of newer VTracer versions are not ported.
 */
import { BinaryImage } from "./binaryImage";
import { type Color, clusterColors, type RgbaImage } from "./colorClusters";
import { samePoint } from "./geometry";
import { type Contour, type FitMode, type FitParams, traceRegion } from "./trace";

export type { RgbaImage } from "./colorClusters";
export type { Contour, FitMode } from "./trace";

export interface VtracerConfig {
  /** "binary" thresholds to black and white, "color" clusters colors hierarchically. */
  clustering: "binary" | "color";
  /** Speckles smaller than this side length (px; the area is its square) are dropped. */
  filterSpeckle: number;
  /** Significant bits per RGB channel (1..8). */
  colorPrecision: number;
  /** Color difference between gradient layers. */
  layerDifference: number;
  mode: FitMode;
  /** Degrees */
  cornerThreshold: number;
  /** px */
  lengthThreshold: number;
  maxIterations: number;
  /** Degrees */
  spliceThreshold: number;
  /** Binary clustering: pixels darker than this (0..255, mean of R, G and B) are foreground. */
  binaryThreshold: number;
  /** Decimal places of the coordinates in the SVG paths. */
  pathPrecision: number;
}

export const DEFAULT_VTRACER_CONFIG: VtracerConfig = {
  clustering: "color",
  filterSpeckle: 4,
  colorPrecision: 6,
  layerDifference: 16,
  mode: "spline",
  cornerThreshold: 60,
  lengthThreshold: 4,
  maxIterations: 10,
  spliceThreshold: 45,
  binaryThreshold: 128,
  pathPrecision: 2,
};

export interface VectorShape {
  /** "#rrggbb" */
  color: string;
  contours: Contour[];
}

/** Shapes in paint order (the first is at the bottom), in pixel coordinates of the image. */
export interface VectorDoc {
  width: number;
  height: number;
  shapes: VectorShape[];
}

interface Layer {
  mask: BinaryImage;
  left: number;
  top: number;
  color: Color;
}

const hex = ({ r, g, b }: Color) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const radians = (degrees: number) => (degrees / 180) * Math.PI;

function binaryLayers(image: RgbaImage, config: VtracerConfig): Layer[] {
  const { width, height, data } = image;
  const binary = new BinaryImage(width, height);
  for (let i = 0; i < width * height; i++) {
    const intensity = Math.floor((data[i * 4]! + data[i * 4 + 1]! + data[i * 4 + 2]!) / 3);
    binary.data[i] = intensity < config.binaryThreshold ? 1 : 0;
  }
  const minArea = config.filterSpeckle * config.filterSpeckle;
  return binary
    .toClusters(false)
    .filter((cluster) => cluster.size >= minArea)
    .map((cluster) => ({ mask: cluster.toBinaryImage(), left: cluster.rect.left, top: cluster.rect.top, color: { r: 0, g: 0, b: 0 } }));
}

function colorLayers(image: RgbaImage, config: VtracerConfig): Layer[] {
  return clusterColors(image, {
    diagonal: config.layerDifference === 0,
    goodMinArea: config.filterSpeckle * config.filterSpeckle,
    goodMaxArea: image.width * image.height,
    isSameColorA: 8 - config.colorPrecision,
    isSameColorB: 1,
    deepenDiff: config.layerDifference,
    hollowNeighbours: 1,
  });
}

export function vtrace(image: RgbaImage, overrides: Partial<VtracerConfig> = {}): VectorDoc {
  const config = { ...DEFAULT_VTRACER_CONFIG, ...overrides };
  if (image.width === 0 || image.height === 0) throw new Error("Empty image");
  const layers = config.clustering === "binary" ? binaryLayers(image, config) : colorLayers(image, config);
  const params: FitParams = {
    cornerThreshold: radians(config.cornerThreshold),
    lengthThreshold: config.lengthThreshold,
    maxIterations: config.maxIterations,
    spliceThreshold: radians(config.spliceThreshold),
  };
  const shapes: VectorShape[] = [];
  for (const layer of layers) {
    const contours = traceRegion(layer.mask, layer.left, layer.top, config.mode, params);
    if (contours.length > 0) shapes.push({ color: hex(layer.color), contours });
  }
  return { width: image.width, height: image.height, shapes };
}

/** Like VTracer: fixed decimals with trailing zeros removed. */
export function formatNumber(n: number, precision: number): string {
  const text = n.toFixed(precision);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

/** The SVG path data of a shape: one closed subpath per contour, absolute coordinates. */
export function pathData(contours: Contour[], precision = DEFAULT_VTRACER_CONFIG.pathPrecision): string {
  const f = (n: number) => formatNumber(n, precision);
  const pt = (p: { x: number; y: number }) => `${f(p.x)} ${f(p.y)}`;
  return contours
    .map(({ kind, points }) => {
      if (kind === "polygon") {
        const body = points.length > 1 && samePoint(points[0]!, points.at(-1)!) ? points.slice(0, -1) : points;
        return `M${pt(body[0]!)}${body.slice(1).map((p) => `L${pt(p)}`).join("")}Z`;
      }
      let d = `M${pt(points[0]!)}`;
      for (let i = 1; i + 2 < points.length; i += 3) d += `C${pt(points[i]!)} ${pt(points[i + 1]!)} ${pt(points[i + 2]!)}`;
      return `${d}Z`;
    })
    .join("");
}

/** A complete SVG document, as VTracer writes it. */
export function toSvg(doc: VectorDoc, precision = DEFAULT_VTRACER_CONFIG.pathPrecision): string {
  const paths = doc.shapes.map((shape) => `<path d="${pathData(shape.contours, precision)}" fill="${shape.color}"/>`);
  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}">\n${paths.join("\n")}\n</svg>\n`;
}
