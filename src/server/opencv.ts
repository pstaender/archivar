import cv from "@techstark/opencv-js";
import { initOpenCv } from "../shared/image/opencv";

export const loadOpenCv = (): Promise<void> => initOpenCv(cv);
