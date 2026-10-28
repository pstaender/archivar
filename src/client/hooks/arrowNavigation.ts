import { useEffect, useRef } from "react";

/** Arrow keys belong to whatever is focused there: text, selects, sliders, editable content. */
function usesArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("input, textarea, select, [role=slider], dialog[open]")) return true;
  return false;
}

function ignoresKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
  return usesArrowKeys(event.target) || document.querySelector("dialog[open]") !== null;
}

/** Calls `previous`/`next` on ← / → unless the key is used by the focused element or a modifier is held. */
export function useArrowNavigation(previous: (() => void) | null, next: (() => void) | null): void {
  const handlers = useRef({ previous, next });
  handlers.current = { previous, next };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignoresKey(event)) return;
      const handler = event.key === "ArrowLeft" ? handlers.current.previous : event.key === "ArrowRight" ? handlers.current.next : null;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/** Calls `back` on Escape under the same conditions, unless something else (a menu, a selection) used the key. */
export function useEscapeNavigation(back: (() => void) | null): void {
  const handler = useRef(back);
  handler.current = back;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !handler.current || ignoresKey(event)) return;
      event.preventDefault();
      handler.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
