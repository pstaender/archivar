import { useEffect, useRef } from "react";
import { api } from "../api";

/** Polling only fetches a fingerprint of the library; the list itself is loaded again only when it changed. */
export const LIBRARY_CHECK_INTERVAL = 30_000;

/** Calls `onChange` when the library was changed elsewhere (another tab, device or API upload) while the page is open. */
export function useLibraryUpdates(onChange: () => void, interval = LIBRARY_CHECK_INTERVAL): void {
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    let version: string | null = null;
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const next = (await api.libraryVersion()).version;
        if (version !== null && next !== version) latest.current();
        version = next;
      } catch {
        // Next check tries again; errors would only repeat what the page already shows.
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), interval);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [interval]);
}
