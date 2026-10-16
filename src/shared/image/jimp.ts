import { Buffer } from "buffer";
import { createJimp } from "@jimp/core";
import bmp from "@jimp/js-bmp";
import gif from "@jimp/js-gif";
import jpeg from "@jimp/js-jpeg";
import png from "@jimp/js-png";
import tiff from "@jimp/js-tiff";
import * as color from "@jimp/plugin-color";
import * as crop from "@jimp/plugin-crop";
import * as resize from "@jimp/plugin-resize";
import * as rotate from "@jimp/plugin-rotate";

export const Jimp = createJimp({
  plugins: [color.methods, crop.methods, resize.methods, rotate.methods],
  formats: [bmp, gif, jpeg, png, tiff],
});

export type JimpImage = InstanceType<typeof Jimp>;

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/bmp", "image/gif", "image/tiff"];

export function isEditableImageType(mimeType: string): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase());
}

export function createImage(width: number, height: number, data: Uint8Array | Uint8ClampedArray): JimpImage {
  return Jimp.fromBitmap({ width, height, data: Buffer.from(data.buffer, data.byteOffset, data.byteLength) });
}
