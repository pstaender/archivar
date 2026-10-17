import type { VectorArea, VectorGraphic, VectorSettings } from "./types";

type Rect = Pick<VectorArea, "x" | "y" | "width" | "height">;

export type VectorizerRequest =
  | { type: "suggest"; id: number; url: string; area: Rect }
  | { type: "vectorize"; id: number; url: string; area: Rect; settings: VectorSettings };

export type VectorizerResponse =
  | { type: "suggested"; id: number; settings: VectorSettings }
  | { type: "vectorized"; id: number; graphic: VectorGraphic; ms: number }
  | { type: "error"; id: number; message: string };
