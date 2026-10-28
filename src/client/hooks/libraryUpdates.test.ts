import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { type FetchMock, mockFetch } from "../../../test/client";
import { useLibraryUpdates } from "./libraryUpdates";

const sleep = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

let fetchMock: FetchMock | undefined;
afterEach(() => fetchMock?.restore());

describe("useLibraryUpdates", () => {
  test("reports a change only when the library version differs from the last check", async () => {
    let version = "1";
    fetchMock = mockFetch({ "GET /api/library/version": () => ({ version }) });
    const onChange = mock();
    renderHook(() => useLibraryUpdates(onChange, 10));
    await sleep(40);
    expect(onChange).not.toHaveBeenCalled();

    version = "2";
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    await sleep(40);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
