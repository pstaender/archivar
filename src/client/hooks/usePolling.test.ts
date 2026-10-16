import { describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { usePolling } from "./usePolling";
import { useResource } from "./useResource";

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe("usePolling", () => {
  test("polls while active and stops after the maximum duration", async () => {
    const poll = mock();
    renderHook(() => usePolling(true, poll, 10, 60));
    await sleep(40);
    expect(poll.mock.calls.length).toBeGreaterThanOrEqual(2);
    await sleep(80);
    const calls = poll.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(6);
    await sleep(50);
    expect(poll.mock.calls.length).toBe(calls);
  });

  test("does not poll while inactive and restarts the time limit when it becomes active again", async () => {
    const poll = mock();
    const { rerender } = renderHook(({ active }) => usePolling(active, poll, 10, 60), { initialProps: { active: false } });
    await sleep(40);
    expect(poll).not.toHaveBeenCalled();
    rerender({ active: true });
    await sleep(40);
    expect(poll.mock.calls.length).toBeGreaterThan(0);
    rerender({ active: false });
    const calls = poll.mock.calls.length;
    await sleep(40);
    expect(poll.mock.calls.length).toBe(calls);
  });
});

describe("useResource", () => {
  test("refreshes data in the background without reporting loading", async () => {
    let value = 1;
    const { result } = renderHook(() => useResource(async () => value, []));
    await waitFor(() => expect(result.current.data).toBe(1));

    value = 2;
    const loadingStates: boolean[] = [];
    const refreshing = act(() => result.current.refresh());
    loadingStates.push(result.current.loading);
    await refreshing;
    loadingStates.push(result.current.loading);
    expect(result.current.data).toBe(2);
    expect(loadingStates).toEqual([false, false]);

    value = 3;
    let reloading!: Promise<void>;
    act(() => {
      reloading = result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    await act(() => reloading);
    expect(result.current).toMatchObject({ data: 3, loading: false });
  });
});
