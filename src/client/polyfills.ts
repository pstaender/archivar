import { Buffer } from "buffer";

// Jimp's codecs reference the Node global `Buffer` directly.
globalThis.Buffer ??= Buffer;
