import { Buffer } from "buffer";

// Jimp and its codecs reference the Node global `Buffer` directly; import this first in browser entry points.
globalThis.Buffer ??= Buffer;
