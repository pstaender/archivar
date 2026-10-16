import type * as OpenCvModule from "@techstark/opencv-js";

export type OpenCv = typeof OpenCvModule;

let instance: OpenCv | null = null;

export function openCv(): OpenCv {
  if (!instance) throw new Error("OpenCV is not loaded");
  return instance;
}

export function isOpenCvReady(): boolean {
  return instance !== null;
}

// The Emscripten module is a thenable that resolves to itself, so it must never be awaited or passed to resolve().
export function initOpenCv(module: unknown): Promise<void> {
  const cv = module as OpenCv & { onRuntimeInitialized?: () => void };
  return new Promise((resolve) => {
    const done = () => {
      instance = cv;
      resolve();
    };
    if (typeof cv.Mat === "function") done();
    else cv.onRuntimeInitialized = done;
  });
}
