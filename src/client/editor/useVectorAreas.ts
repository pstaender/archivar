import { useEffect, useMemo, useRef, useState } from "react";
import { VectorizeCancelledError, VectorizerClient } from "../../vectorizer/client";
import { DEFAULT_VECTOR_SETTINGS, type VectorArea, type VectorSettings } from "../../vectorizer";
import type { ArchiveDocument } from "../../shared/types";
import { api, assetUrl } from "../api";
import type { Rect } from "./rects";
import { translateWorkerError } from "../serverMessages";

const rectKey = (a: Rect) => JSON.stringify([a.x, a.y, a.width, a.height]);
const settingsKey = (s: VectorSettings) => JSON.stringify(s);

/** What an area's graphic was made from. */
interface Rendered {
  rect: string;
  settings: string;
}

let created = 0;
const newId = () => `v${Date.now().toString(36)}${(created++).toString(36)}`;

export type VectorAreasState = ReturnType<typeof useVectorAreas>;

/**
 * The Vektor tab's draft: areas are vectorized in the worker one after another whenever they are new, were moved or
 * resized, or their settings changed. New areas first get settings suggested for their pixels.
 */
export function useVectorAreas(doc: ArchiveDocument | undefined, onError: (error: unknown) => void) {
  const [saved, setSaved] = useState<VectorArea[] | null>(null);
  const [outdated, setOutdated] = useState(false);
  const [areas, setAreas] = useState<VectorArea[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState<{ id: string; step: "suggest" | "vectorize"; rect: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [rendered, setRendered] = useState<Map<string, Rendered>>(new Map());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [toSuggest, setToSuggest] = useState<Set<string>>(new Set());
  const client = useMemo(() => new VectorizerClient(), []);
  const errorRef = useRef(onError);
  errorRef.current = (error) => onError(translateWorkerError(error));

  useEffect(() => () => client.dispose(), [client]);

  const reset = (list: VectorArea[]) => {
    setSaved(list);
    setAreas(list);
    setRendered(new Map(list.map((a) => [a.id, { rect: rectKey(a), settings: settingsKey(a.settings) }])));
    setFailed(new Map());
    setToSuggest(new Set());
  };

  useEffect(() => {
    client.cancel();
    setSaved(null);
    setAreas([]);
    setSelected(null);
    if (!doc || doc.kind !== "image") return;
    if (doc.vectorCount === 0) {
      reset([]);
      setOutdated(false);
      return;
    }
    let cancelled = false;
    api.vectors(doc.id).then(
      (result) => {
        if (cancelled) return;
        reset(result.areas);
        setOutdated(result.outdated);
      },
      (error) => !cancelled && errorRef.current(error),
    );
    return () => {
      cancelled = true;
    };
  }, [doc?.id]);

  const isCurrent = (area: VectorArea) => {
    const r = rendered.get(area.id);
    return area.graphic !== null && r?.rect === rectKey(area) && r.settings === settingsKey(area.settings);
  };
  const needsWork = (area: VectorArea) => !isCurrent(area) && failed.get(area.id) !== rectKey(area) + settingsKey(area.settings);

  const url = doc ? assetUrl(doc, "edited") : "";

  useEffect(() => {
    if (!doc || working || dragging || saving) return;
    const queue = areas.filter(needsWork);
    const area = queue.find((a) => a.id === selected) ?? queue[0];
    if (!area) return;
    const requested = { rect: rectKey(area), settings: settingsKey(area.settings) };
    const stillRequested = (current: VectorArea | undefined) => current !== undefined && rectKey(current) === requested.rect;

    if (toSuggest.has(area.id)) {
      setWorking({ id: area.id, step: "suggest", rect: requested.rect });
      client
        .suggest(url, area)
        .then(
          (settings) => setAreas((list) => list.map((a) => (a.id === area.id && stillRequested(a) ? { ...a, settings } : a))),
          (error) => !(error instanceof VectorizeCancelledError) && errorRef.current(error),
        )
        .finally(() => {
          setToSuggest((set) => new Set([...set].filter((id) => id !== area.id)));
          setWorking(null);
        });
      return;
    }

    setWorking({ id: area.id, step: "vectorize", rect: requested.rect });
    const start = performance.now();
    client
      .vectorize(url, area, area.settings)
      .then(
        (graphic) => {
          setLastMs(performance.now() - start);
          setAreas((list) =>
            list.map((a) => (a.id === area.id && stillRequested(a) && settingsKey(a.settings) === requested.settings ? { ...a, graphic } : a)),
          );
          setRendered((map) => new Map(map).set(area.id, requested));
        },
        (error) => {
          if (error instanceof VectorizeCancelledError) return;
          setFailed((map) => new Map(map).set(area.id, requested.rect + requested.settings));
          errorRef.current(error);
        },
      )
      .finally(() => setWorking(null));
  }, [areas, working, dragging, saving, selected, rendered, failed, toSuggest, url]);

  // A running request for an area that was removed, moved or resized is no longer needed.
  useEffect(() => {
    if (!working) return;
    const area = areas.find((a) => a.id === working.id);
    if (!area || rectKey(area) !== working.rect) client.cancel();
  }, [areas, working]);

  const changeSettings = (id: string, settings: VectorSettings) => {
    if (working?.id === id && working.step === "vectorize") client.cancel();
    setAreas((list) => list.map((a) => (a.id === id ? { ...a, settings } : a)));
  };

  const resuggest = (id: string) => {
    if (working?.id === id) client.cancel();
    setToSuggest((set) => new Set(set).add(id));
    setFailed((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
    setRendered((map) => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
  };

  const create = (rect: Rect): VectorArea => {
    const area: VectorArea = { id: newId(), ...rect, settings: DEFAULT_VECTOR_SETTINGS, graphic: null };
    setToSuggest((set) => new Set(set).add(area.id));
    return area;
  };

  const savable = areas.filter((a) => a.graphic !== null && isCurrent(a));
  const dirty = saved !== null && JSON.stringify(savable) !== JSON.stringify(saved);
  const pending = areas.some(needsWork);

  const save = async (): Promise<ArchiveDocument | null> => {
    if (!doc) return null;
    setSaving(true);
    try {
      const result = await api.saveVectors(doc.id, savable);
      reset(result.areas);
      setOutdated(false);
      setSelected((current) => (result.areas.some((a) => a.id === current) ? current : null));
      return result.document;
    } catch (error) {
      errorRef.current(error);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    client.cancel();
    if (saved) reset(saved);
    setSelected(null);
  };

  return {
    loaded: saved !== null,
    areas,
    setAreas,
    selected,
    setSelected,
    setDragging,
    outdated,
    working,
    pending,
    failedIds: new Set(areas.filter((a) => failed.get(a.id) === rectKey(a) + settingsKey(a.settings)).map((a) => a.id)),
    lastMs,
    dirty,
    saving,
    /** The graphic is shown only on the rectangle it was made for. */
    showsGraphic: (area: VectorArea) => area.graphic !== null && rendered.get(area.id)?.rect === rectKey(area),
    isCurrent,
    changeSettings,
    resuggest,
    create,
    /** Stops the running vectorization; the area is not tried again until it or its settings change. */
    cancel: () => {
      const area = areas.find((a) => a.id === working?.id);
      if (area) setFailed((map) => new Map(map).set(area.id, rectKey(area) + settingsKey(area.settings)));
      client.cancel();
    },
    save,
    discard,
  };
}
