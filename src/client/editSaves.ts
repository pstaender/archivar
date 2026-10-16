import { useEffect, useRef, useSyncExternalStore } from "react";
import type { ArchiveDocument, EditSettings } from "../shared/types";
import { api } from "./api";

// Saving edit settings renders the full-size image on the server, which takes a while. Saves run in the background,
// one after another per document, so the editor stays usable and an older save never finishes after a newer one.

export interface EditSaveResult {
  doc: ArchiveDocument;
  /** False when a newer save of the same document was queued in the meantime. */
  latest: boolean;
}

const queues = new Map<number, { tail: Promise<unknown>; count: number; latest: number }>();
const listeners = new Set<() => void>();
let finished = 0;

const notify = () => {
  for (const listener of listeners) listener();
};

export function saveEditSettings(id: number, editSettings: EditSettings): Promise<EditSaveResult> {
  const queue = queues.get(id) ?? { tail: Promise.resolve(), count: 0, latest: 0 };
  queues.set(id, queue);
  const ticket = ++queue.latest;
  queue.count++;
  notify();
  const run = queue.tail.catch(() => undefined).then(() => api.updateDocument(id, { editSettings }));
  queue.tail = run;
  const settle = () => {
    if (--queue.count === 0) queues.delete(id);
    finished++;
    notify();
  };
  return run.then(
    (doc) => {
      settle();
      return { doc, latest: ticket === queue.latest };
    },
    (error: unknown) => {
      settle();
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { latest: ticket === queue.latest });
    },
  );
}

/** Resolves once the document's queued saves (or all of them without an id) are done, whether they failed or not. */
export async function whenEditsSaved(id?: number): Promise<void> {
  const tails = id === undefined ? [...queues.values()].map((q) => q.tail) : [queues.get(id)?.tail];
  await Promise.allSettled(tails);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useEditSaving(id: number | undefined): boolean {
  return useSyncExternalStore(subscribe, () => id !== undefined && queues.has(id));
}

/** Calls `refresh` whenever a background save finishes, e.g. to show the new thumbnails. */
export function useRefreshOnEditSave(refresh: () => void): void {
  const count = useSyncExternalStore(subscribe, () => finished);
  const seen = useRef(count);
  useEffect(() => {
    if (count === seen.current) return;
    seen.current = count;
    refresh();
  }, [count, refresh]);
}
