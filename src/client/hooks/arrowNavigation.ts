import { useEffect, useRef } from "react";

/** Arrow keys belong to whatever is focused there: text, selects, sliders, editable content. */
function usesArrowKeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("input, textarea, select, [role=slider], dialog[open]")) return true;
  return false;
}

/** Calls `previous`/`next` on ← / → unless the key is used by the focused element or a modifier is held. */
export function useArrowNavigation(previous: (() => void) | null, next: (() => void) | null): void {
  const handlers = useRef({ previous, next });
  handlers.current = { previous, next };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (usesArrowKeys(event.target) || document.querySelector("dialog[open]")) return;
      const handler = event.key === "ArrowLeft" ? handlers.current.previous : event.key === "ArrowRight" ? handlers.current.next : null;
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
