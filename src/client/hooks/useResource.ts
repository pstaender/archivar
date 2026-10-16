import { type DependencyList, useCallback, useEffect, useRef, useState } from "react";

export interface Resource<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Reloads in the background: `loading` stays false, so the page does not flicker while polling. */
  refresh: () => Promise<void>;
  setData: (data: T | ((current: T | undefined) => T)) => void;
}

export function useResource<T>(load: () => Promise<T>, deps: DependencyList): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  const run = useCallback(load, deps);

  const fetchData = useCallback(async (background: boolean) => {
    const id = ++requestId.current;
    if (!background) setLoading(true);
    try {
      const result = await run();
      if (id === requestId.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [run]);

  const reload = useCallback(() => fetchData(false), [fetchData]);
  const refresh = useCallback(() => fetchData(true), [fetchData]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, refresh, setData: setData as Resource<T>["setData"] };
}
