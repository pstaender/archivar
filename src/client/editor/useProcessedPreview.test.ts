import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { mockFetch, type FetchMock } from "../../../test/client";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { EditSettings } from "../../shared/types";
import { useProcessedPreview } from "./useProcessedPreview";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const jpeg = () => new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } });

function setup(onError = mock()) {
  return renderHook(({ settings }: { settings: EditSettings }) => useProcessedPreview(7, settings, onError), {
    initialProps: { settings: DEFAULT_EDIT_SETTINGS },
  });
}

describe("useProcessedPreview", () => {
  test("renders the current settings once, even when requested twice", async () => {
    fetchMock = mockFetch({ "POST /api/documents/7/render": jpeg });
    const { result } = setup();
    await act(async () => {
      void result.current.request();
      void result.current.request();
    });
    await waitFor(() => expect(result.current.src).toStartWith("blob:"));
    expect(fetchMock.calls).toHaveLength(1);
    expect(result.current.processing).toBe(false);
  });

  test("drops the rendered image when the settings change", async () => {
    fetchMock = mockFetch({ "POST /api/documents/7/render": jpeg });
    const { result, rerender } = setup();
    await act(() => result.current.request());
    expect(result.current.src).not.toBeNull();
    rerender({ settings: { ...DEFAULT_EDIT_SETTINGS, colorMode: "bw" } });
    expect(result.current.src).toBeNull();
  });

  test("reports errors", async () => {
    const onError = mock();
    fetchMock = mockFetch({ "POST /api/documents/7/render": () => Response.json({ error: "Kaputt" }, { status: 500 }) });
    const { result } = setup(onError);
    await act(() => result.current.request());
    expect(onError).toHaveBeenCalled();
    expect(result.current.src).toBeNull();
    expect(result.current.processing).toBe(false);
  });
});
