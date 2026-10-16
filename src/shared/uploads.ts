import { SUPPORTED_IMAGE_TYPES } from "./image/jimp";

export interface ConvertibleImageFormat {
  mimeType: string;
  extensions: string[];
  coder: string;
}

// Decoded with ImageMagick on the server when it is installed.
export const CONVERTIBLE_IMAGE_FORMATS: ConvertibleImageFormat[] = [
  { mimeType: "image/heic", extensions: [".heic"], coder: "HEIC" },
  { mimeType: "image/heif", extensions: [".heif"], coder: "HEIF" },
  { mimeType: "image/avif", extensions: [".avif"], coder: "AVIF" },
  { mimeType: "image/webp", extensions: [".webp"], coder: "WEBP" },
  { mimeType: "image/jxl", extensions: [".jxl"], coder: "JXL" },
  { mimeType: "image/jp2", extensions: [".jp2"], coder: "JP2" },
];

export const SUPPORTED_UPLOAD_TYPES = [...SUPPORTED_IMAGE_TYPES, "application/pdf"];
export const SUPPORTED_UPLOAD_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".pdf"];

function convertibleFormats(types: readonly string[]): ConvertibleImageFormat[] {
  return CONVERTIBLE_IMAGE_FORMATS.filter((format) => types.includes(format.mimeType));
}

export function uploadAccept(convertibleTypes: readonly string[] = []): string {
  const extra = convertibleFormats(convertibleTypes);
  return [
    ...SUPPORTED_UPLOAD_TYPES,
    ...extra.map((format) => format.mimeType),
    ...SUPPORTED_UPLOAD_EXTENSIONS,
    ...extra.flatMap((format) => format.extensions),
  ].join(",");
}

export function convertibleTypeForExtension(name: string): string | null {
  const ext = extensionOf(name);
  return CONVERTIBLE_IMAGE_FORMATS.find((format) => format.extensions.includes(ext))?.mimeType ?? null;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function isSupportedUpload(file: { name: string; type: string }, convertibleTypes: readonly string[] = []): boolean {
  const extra = convertibleFormats(convertibleTypes);
  const type = file.type.split(";")[0]!.trim().toLowerCase();
  if (type && type !== "application/octet-stream") {
    return SUPPORTED_UPLOAD_TYPES.includes(type) || extra.some((format) => format.mimeType === type);
  }
  const ext = extensionOf(file.name);
  return SUPPORTED_UPLOAD_EXTENSIONS.includes(ext) || extra.some((format) => format.extensions.includes(ext));
}
