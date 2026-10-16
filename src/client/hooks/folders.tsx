import { createContext, type ReactNode, useContext } from "react";
import type { Folder } from "../../shared/types";
import { api } from "../api";
import { useResource } from "./useResource";

interface FoldersApi {
  folders: Folder[];
  reload: () => Promise<void>;
}

const FoldersContext = createContext<FoldersApi | null>(null);

export function FoldersProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useResource(() => api.folders(), []);
  return <FoldersContext.Provider value={{ folders: data ?? [], reload }}>{children}</FoldersContext.Provider>;
}

export function useFolders(): FoldersApi {
  const ctx = useContext(FoldersContext);
  if (!ctx) throw new Error("useFolders must be used inside FoldersProvider");
  return ctx;
}
