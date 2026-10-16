import { initOpenCv, isOpenCvReady } from "../../shared/image/opencv";
import { OPENCV_URL } from "../../shared/opencvAsset";

let loading: Promise<void> | null = null;

// OpenCV.js is ~11 MB, so it is fetched as a separate script only when the editor needs it.
export function loadOpenCv(): Promise<void> {
  if (isOpenCvReady()) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => {
      initOpenCv((window as unknown as { cv: unknown }).cv).then(resolve, reject);
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("OpenCV konnte nicht geladen werden"));
    };
    document.head.append(script);
  });
  return loading;
}
