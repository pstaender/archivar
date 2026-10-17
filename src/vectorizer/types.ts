export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export type VectorMode = "bw" | "color";
export type VectorCurves = "smooth" | "sharp";

/** The few settings the user chooses; a backend maps them onto its own parameters. */
export interface VectorSettings {
  /** "bw": black shapes on white; "color": layers of the image's colors. */
  mode: VectorMode;
  /** 1 (coarse, small details are dropped) … 5 (fine). */
  detail: number;
  /** "smooth": curves; "sharp": straight edges. */
  curves: VectorCurves;
  /** "bw" only: pixels darker than this (0..255) become black. */
  threshold: number;
}

export interface VectorPath {
  /** SVG path data in the graphic's coordinates. */
  d: string;
  /** "#rrggbb" */
  fill: string;
}

/** The vectorized pixels: paths in paint order over a background, in a `width` × `height` coordinate system. */
export interface VectorGraphic {
  width: number;
  height: number;
  /** "#rrggbb", fills the whole area below the paths. */
  background: string;
  paths: VectorPath[];
}

/** A rectangle of the edited image (0..1) that is replaced by its vector graphic. */
export interface VectorArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  settings: VectorSettings;
  /** null until it is vectorized (new areas, or after moving or resizing). */
  graphic: VectorGraphic | null;
}

export interface VectorizerBackend {
  readonly id: string;
  /** `pixelScale`: how many pixels of the image make up a pixel of a 300 DPI A4 page, so details scale with resolution. */
  vectorize(image: RgbaImage, settings: VectorSettings, pixelScale: number): VectorGraphic;
}
