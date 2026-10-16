import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";

export interface LeaveGuard {
  /** True while the user is asked what to do with the unsaved changes. */
  asking: boolean;
  /** Runs `action` right away, or after `proceed()` when there are unsaved changes. */
  guard(action: () => void): void;
  /** Continues the navigation or action that was held back. */
  proceed(): void;
  /** Cancels it and stays. */
  stay(): void;
  /** Lets the next navigation through without asking, e.g. after deleting the document. */
  skipNext(): void;
}

/** Holds back route changes, guarded in-page actions and closing the tab while `dirty` is true. */
export function useLeaveGuard(dirty: boolean): LeaveGuard {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const skip = useRef(false);
  const [pending, setPending] = useState<{ action: () => void } | null>(null);

  const blocker = useBlocker(
    useCallback(({ currentLocation, nextLocation }) => {
      if (skip.current) {
        skip.current = false;
        return false;
      }
      return dirtyRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search);
    }, []),
  );

  useEffect(() => {
    if (!dirty) return;
    // Browsers only show their own generic question here; saving from it is not possible.
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return {
    asking: blocker.state === "blocked" || pending !== null,
    guard: (action) => (dirtyRef.current ? setPending({ action }) : action()),
    proceed: () => {
      if (blocker.state === "blocked") blocker.proceed();
      pending?.action();
      setPending(null);
    },
    stay: () => {
      if (blocker.state === "blocked") blocker.reset();
      setPending(null);
    },
    skipNext: () => {
      skip.current = true;
    },
  };
}
