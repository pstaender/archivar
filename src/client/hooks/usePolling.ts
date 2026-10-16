import { useEffect } from "react";

// Server-side OCR gives up after a few minutes per page; this only stops a client that would otherwise poll forever.
export const MAX_POLL_DURATION = 10 * 60_000;

/** Calls `poll` every `interval` ms while `active`, for at most `maxDuration` ms per active phase. */
export function usePolling(active: boolean, poll: () => void, interval: number, maxDuration = MAX_POLL_DURATION): void {
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started >= maxDuration) clearInterval(timer);
      else poll();
    }, interval);
    return () => clearInterval(timer);
  }, [active, poll, interval, maxDuration]);
}
