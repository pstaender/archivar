import { openCv } from "./opencv";
import type { RawImage } from "./raw";

// Parameters are tuned for a 2000 px long side and scaled with the image, so preview and final render match.
const REFERENCE_SIZE = 2000;
// OpenCV sums the color difference over the three channels, so sigmaColor is about 3× a per-channel difference.
const LEVELS = [
  { diameter: 5, sigmaColor: 40, speckArea: 8 },
  { diameter: 7, sigmaColor: 70, speckArea: 20 },
  { diameter: 9, sigmaColor: 110, speckArea: 50 },
];
const MAX_DIAMETER = 15;
// Small marks this close to text are kept: dots on i/ä, periods, commas.
const TEXT_DISTANCE = 20;

function level(strength: number) {
  return LEVELS[Math.min(LEVELS.length, Math.max(1, strength)) - 1]!;
}

function scaleOf(image: RawImage): number {
  return Math.max(image.width, image.height) / REFERENCE_SIZE;
}

/** Edge-preserving smoothing (bilateral filter): flattens paper grain and sensor noise but keeps strokes sharp. */
export function smoothNoise(image: RawImage, strength: number): RawImage {
  const cv = openCv();
  const { diameter, sigmaColor } = level(strength);
  const d = Math.min(MAX_DIAMETER, Math.max(3, Math.round(diameter * scaleOf(image)) | 1));
  const rgba = new cv.Mat(image.height, image.width, cv.CV_8UC4);
  const rgb = new cv.Mat();
  const filtered = new cv.Mat();
  try {
    rgba.data.set(image.data);
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    cv.bilateralFilter(rgb, filtered, d, sigmaColor, d);
    cv.cvtColor(filtered, rgba, cv.COLOR_RGB2RGBA);
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(rgba.data) };
  } finally {
    rgba.delete();
    rgb.delete();
    filtered.delete();
  }
}

/** Removes isolated black specks from a binarized image in place. */
export function removeSpecks(image: RawImage, strength: number): void {
  const cv = openCv();
  const scale = scaleOf(image);
  const maxArea = Math.max(1, Math.round(level(strength).speckArea * scale * scale));
  // Specks are roughly round; thin marks like a lone "i" or "l" are text.
  const maxExtent = Math.max(2, Math.round(2 * Math.sqrt(maxArea)));
  const { width, height, data } = image;
  const size = width * height;

  const ink = new cv.Mat(height, width, cv.CV_8UC1);
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  const text = new cv.Mat(height, width, cv.CV_8UC1);
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2 * Math.round(TEXT_DISTANCE * scale) + 1, 2 * Math.round(TEXT_DISTANCE * scale) + 1));
  try {
    const inkData = ink.data;
    for (let p = 0; p < size; p++) inkData[p] = data[p * 4]! < 128 ? 255 : 0;

    const count = cv.connectedComponentsWithStats(ink, labels, stats, centroids, 8, cv.CV_32S);
    const small = new Uint8Array(count);
    const stat = stats.data32S;
    for (let label = 1; label < count; label++) {
      const at = label * 5;
      const compact = Math.max(stat[at + cv.CC_STAT_WIDTH]!, stat[at + cv.CC_STAT_HEIGHT]!) <= maxExtent;
      small[label] = compact && stat[at + cv.CC_STAT_AREA]! <= maxArea ? 1 : 0;
    }

    const ids = labels.data32S;
    const textData = text.data;
    for (let p = 0; p < size; p++) textData[p] = ids[p]! > 0 && !small[ids[p]!] ? 255 : 0;
    cv.dilate(text, text, kernel);

    const nearText = new Uint8Array(count);
    for (let p = 0; p < size; p++) if (small[ids[p]!] && textData[p]) nearText[ids[p]!] = 1;
    for (let p = 0; p < size; p++) {
      const id = ids[p]!;
      if (small[id] && !nearText[id]) data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
    }
  } finally {
    ink.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
    text.delete();
    kernel.delete();
  }
}
