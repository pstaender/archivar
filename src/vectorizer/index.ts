/**
 * The vectorizer: replaces rectangles of an image with vector graphics. It is independent of the rest of the app;
 * the vectorizing itself is behind `VectorizerBackend` (currently the VTracer port in `vtracer/`) and runs in the
 * browser in a Web Worker (`worker.ts`, used through `VectorizerClient`).
 */
export * from "./areas";
export * from "./settings";
export type * from "./types";

/** The worker bundle, built on demand by the server (`src/server/vendor.ts`). */
export const VECTORIZER_WORKER_URL = "/assets/vectorizer-worker.js";
