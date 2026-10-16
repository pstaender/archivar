import { useCallback, useEffect, useRef, useState } from "react";
import type { EditSettings } from "../../shared/types";
import { api } from "../api";

interface Rendered {
  url: string;
  key: string;
}

/** Renders the current edit settings on the server; the result is dropped as soon as the settings change. */
export function useProcessedPreview(documentId: number | undefined, settings: EditSettings, onError: (error: unknown) => void) {
  const key = JSON.stringify([documentId, settings]);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [processing, setProcessing] = useState(false);
  const pending = useRef<{ controller: AbortController; key: string } | null>(null);

  const clear = useCallback(() => {
    pending.current?.controller.abort();
    pending.current = null;
    setProcessing(false);
    setRendered((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  useEffect(() => {
    if (pending.current && pending.current.key !== key) clear();
    else setRendered((current) => (current && current.key !== key ? (URL.revokeObjectURL(current.url), null) : current));
  }, [key, clear]);

  useEffect(() => clear, [clear]);

  const request = useCallback(async () => {
    if (documentId === undefined || pending.current) return;
    const controller = new AbortController();
    pending.current = { controller, key };
    setProcessing(true);
    try {
      const blob = await api.renderPreview(documentId, settings, controller.signal);
      if (controller.signal.aborted) return;
      setRendered({ url: URL.createObjectURL(blob), key });
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    } finally {
      if (pending.current?.controller === controller) {
        pending.current = null;
        setProcessing(false);
      }
    }
  }, [documentId, settings, key, onError]);

  return { src: rendered?.key === key ? rendered.url : null, processing, request, clear };
}
