import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

/**
 * Scrolls the element that `find` returns for the location's hash into view once the list is `ready`, once per
 * navigation (refreshes of the list do not scroll again), and focuses its link without scrolling a second time.
 */
export function useScrollToHashItem(ready: boolean, find: (hash: string) => Element | null): void {
  const location = useLocation();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !location.hash || handled.current === location.key) return;
    handled.current = location.key;
    const element = find(location.hash);
    if (!element) return;
    element.scrollIntoView?.({ block: "center" });
    element.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  });
}
