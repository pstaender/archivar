import { createContext, type ReactNode, useContext } from "react";
import type { AppConfig } from "../../shared/types";
import { api } from "../api";
import { useResource } from "./useResource";

const DEFAULT_CONFIG: AppConfig = { dewarpAvailable: false, convertibleImageTypes: [], ocrLanguages: ["deu", "eng"] };

const ConfigContext = createContext<AppConfig>(DEFAULT_CONFIG);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const config = useResource(() => api.config(), []);
  return <ConfigContext.Provider value={config.data ?? DEFAULT_CONFIG}>{children}</ConfigContext.Provider>;
}

export function useConfig(): AppConfig {
  return useContext(ConfigContext);
}
