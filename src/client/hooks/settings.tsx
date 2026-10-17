import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "../../shared/settings";
import { api } from "../api";

// The OCR switches used to be stored per browser; their values are moved to the server once.
const LEGACY_FLAGS: Record<"autoOcr" | "ocrAllText", string> = {
  autoOcr: "archivar.autoOcr",
  ocrAllText: "archivar.ocrAllText",
};
// Replaced by import presets.
const OBSOLETE_KEYS = ["archivar.autoDewarp"];

function takeLegacyFlags(): Partial<UserSettings> {
  const flags: Partial<UserSettings> = {};
  try {
    for (const [name, key] of Object.entries(LEGACY_FLAGS) as [keyof typeof LEGACY_FLAGS, string][]) {
      const value = localStorage.getItem(key);
      if (value !== null) flags[name] = value === "true";
    }
  } catch {}
  return flags;
}

function forgetLegacyFlags() {
  try {
    for (const key of [...Object.values(LEGACY_FLAGS), ...OBSOLETE_KEYS]) localStorage.removeItem(key);
  } catch {}
}

interface SettingsApi {
  /** Defaults until the user's settings are loaded. */
  settings: UserSettings;
  loaded: boolean;
  save: (update: Partial<UserSettings>) => Promise<UserSettings>;
}

const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const legacy = takeLegacyFlags();
    const load = async () => {
      if (Object.keys(legacy).length === 0) return api.settings();
      const migrated = await api.updateSettings(legacy);
      forgetLegacyFlags();
      return migrated;
    };
    load()
      .then((loadedSettings) => {
        if (cancelled) return;
        setSettings(loadedSettings);
        setLoaded(true);
      })
      .catch((error) => console.warn("Could not load the settings:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (update: Partial<UserSettings>) => {
    const saved = await api.updateSettings(update);
    setSettings(saved);
    setLoaded(true);
    return saved;
  }, []);

  const value = useMemo(() => ({ settings, loaded, save }), [settings, loaded, save]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
