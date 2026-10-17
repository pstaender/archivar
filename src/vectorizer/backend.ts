import type { VectorizerBackend } from "./types";
import { pathData, vtrace } from "./vtracer";

const SPECKLE = [16, 8, 4, 2, 1];
const COLOR_PRECISION = [5, 6, 6, 7, 8];
const LAYER_DIFFERENCE = [48, 32, 16, 10, 6];

export const vtracerBackend: VectorizerBackend = {
  id: "vtracer",
  vectorize(image, settings, pixelScale) {
    const level = settings.detail - 1;
    const doc = vtrace(image, {
      clustering: settings.mode === "bw" ? "binary" : "color",
      filterSpeckle: Math.max(1, Math.round(SPECKLE[level]! * pixelScale)),
      colorPrecision: COLOR_PRECISION[level]!,
      layerDifference: LAYER_DIFFERENCE[level]!,
      mode: settings.curves === "sharp" ? "polygon" : "spline",
      binaryThreshold: settings.threshold,
    });
    // In color mode the bottom layer covers the whole image.
    const background = settings.mode === "bw" ? "#ffffff" : (doc.shapes[0]?.color ?? "#ffffff");
    return {
      width: doc.width,
      height: doc.height,
      background,
      paths: doc.shapes.map((shape) => ({ d: pathData(shape.contours), fill: shape.color })),
    };
  },
};

/** The backend the app vectorizes with; another one only has to implement `VectorizerBackend`. */
export const vectorizer: VectorizerBackend = vtracerBackend;
