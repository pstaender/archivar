/** Longest side of the editor's base image. The filters run on it in the browser, so it is not scaled down further. */
export const PREVIEW_SIZE = 3000;

/** The editor's render worker, bundled on demand by the server (`src/server/vendor.ts`). */
export const PREVIEW_WORKER_URL = "/assets/preview-worker.js";
