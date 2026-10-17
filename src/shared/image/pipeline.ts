import type { EditSettings, Quad } from "../types";
import { adjustColor } from "./color";
import { mixGray } from "./grayMix";
import { removeSpecks, smoothNoise } from "./denoise";
import { createImage, type JimpImage } from "./jimp";
import { isAxisAlignedRect, warpPerspective } from "./perspective";
import { unwarpWithGrid } from "./unwarp";

function applyGeometry(image: JimpImage, corners: Quad): JimpImage {
  const { width, height } = image.bitmap;
  if (isAxisAlignedRect(corners)) {
    const x = Math.round(Math.min(corners[0].x, corners[3].x) * width);
    const y = Math.round(Math.min(corners[0].y, corners[1].y) * height);
    const right = Math.round(Math.max(corners[1].x, corners[2].x) * width);
    const bottom = Math.round(Math.max(corners[2].y, corners[3].y) * height);
    return image.crop({ x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) }) as JimpImage;
  }
  const warped = warpPerspective(image.bitmap, corners);
  return createImage(warped.width, warped.height, warped.data);
}

export function luma(data: Uint8Array, i: number): number {
  return 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
}

function binarize(image: JimpImage, threshold: number): void {
  const data = image.bitmap.data;
  for (let i = 0; i < data.length; i += 4) {
    const v = luma(data, i) >= threshold ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
  }
}

export function applyTone(image: JimpImage, settings: Pick<EditSettings, "autoLevels" | "brightness" | "contrast">): void {
  if (settings.autoLevels) image.normalize();
  if (settings.brightness !== 0) image.brightness(1 + settings.brightness);
  if (settings.contrast !== 0) image.contrast(settings.contrast);
}

export function applyEdits(source: JimpImage, settings: EditSettings): JimpImage {
  let image = source.clone() as JimpImage;

  if (settings.rotation !== 0) image = image.rotate(-settings.rotation) as JimpImage;
  if (settings.dewarp) {
    const unwarped = unwarpWithGrid(image.bitmap, settings.dewarp);
    image = createImage(unwarped.width, unwarped.height, unwarped.data);
  }
  if (settings.corners) image = applyGeometry(image, settings.corners);

  if (settings.denoise > 0) {
    const filtered = smoothNoise(image.bitmap, settings.denoise);
    image = createImage(filtered.width, filtered.height, filtered.data);
  }

  applyTone(image, settings);

  if (settings.colorMode === "color") {
    adjustColor(image.bitmap, settings.saturation, settings.hue);
  } else if (settings.colorMode === "grayscale") {
    if (settings.grayMix) mixGray(image.bitmap.data, settings.grayMix);
    else image.greyscale();
  } else {
    binarize(image, settings.bwThreshold);
    if (settings.denoise > 0) removeSpecks(image.bitmap, settings.denoise);
  }

  return image;
}

export function scaleToFit(image: JimpImage, maxSize: number): JimpImage {
  const { width, height } = image.bitmap;
  if (width <= maxSize && height <= maxSize) return image;
  return image.scaleToFit({ w: maxSize, h: maxSize }) as JimpImage;
}
