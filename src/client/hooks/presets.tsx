import { createContext, type ReactNode, useContext } from "react";
import type { ImagePreset } from "../../shared/presets";
import { api } from "../api";
import { useResource } from "./useResource";

interface PresetsApi {
  presets: ImagePreset[];
  reload: () => Promise<void>;
}

const PresetsContext = createContext<PresetsApi | null>(null);

export function PresetsProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useResource(() => api.presets(), []);
  return <PresetsContext.Provider value={{ presets: data ?? [], reload }}>{children}</PresetsContext.Provider>;
}

export function usePresets(): PresetsApi {
  const ctx = useContext(PresetsContext);
  if (!ctx) throw new Error("usePresets must be used inside PresetsProvider");
  return ctx;
}
