import { SUPPORTED_IMAGE_TYPES } from "./image/jimp";

export const SUPPORTED_UPLOAD_TYPES = [...SUPPORTED_IMAGE_TYPES, "application/pdf"];
export const SUPPORTED_UPLOAD_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".pdf"];

export const UPLOAD_ACCEPT = [...SUPPORTED_UPLOAD_TYPES, ...SUPPORTED_UPLOAD_EXTENSIONS].join(",");

export function isSupportedUpload(file: { name: string; type: string }): boolean {
  const type = file.type.split(";")[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream") return SUPPORTED_UPLOAD_TYPES.includes(type);
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 && SUPPORTED_UPLOAD_EXTENSIONS.includes(file.name.slice(dot).toLowerCase());
}
