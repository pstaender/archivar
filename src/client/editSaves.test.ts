import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_EDIT_SETTINGS } from "../shared/editSettings";
import type { EditSettings } from "../shared/types";
import { type FetchMock, makeDocument, mockFetch } from "../../test/client";
import { saveEditSettings, whenEditsSaved } from "./editSaves";

let fetchMock: FetchMock | undefined;
afterEach(() => fetchMock?.restore());

const settings = (brightness: number): EditSettings => ({ ...DEFAULT_EDIT_SETTINGS, brightness });

describe("saveEditSettings", () => {
  test("saves one document after another and marks only the newest save as latest", async () => {
    const releases: (() => void)[] = [];
    const started: number[] = [];
    fetchMock = mockFetch({
      "PATCH /api/documents/7": async (_url, init) => {
        const { editSettings } = JSON.parse(String(init.body)) as { editSettings: EditSettings };
        started.push(editSettings.brightness);
        await new Promise<void>((resolve) => releases.push(resolve));
        return makeDocument({ id: 7, editSettings });
      },
    });
    const first = saveEditSettings(7, settings(10));
    const second = saveEditSettings(7, settings(20));
    let done = false;
    const waiting = whenEditsSaved(7).then(() => (done = true));

    await Bun.sleep(5);
    expect(started).toEqual([10]);
    releases.shift()!();
    expect((await first).latest).toBe(false);
    await Bun.sleep(5);
    expect(started).toEqual([10, 20]);
    expect(done).toBe(false);
    releases.shift()!();
    const result = await second;
    expect(result.latest).toBe(true);
    expect(result.doc.editSettings.brightness).toBe(20);
    await waiting;
    expect(done).toBe(true);
  });

  test("keeps going after a failed save and reports whether it was the newest", async () => {
    let calls = 0;
    fetchMock = mockFetch({
      "PATCH /api/documents/8": () => (++calls === 1 ? Response.json({ error: "Kaputt" }, { status: 500 }) : makeDocument({ id: 8 })),
    });
    const failed = saveEditSettings(8, settings(10)).catch((error: Error & { latest?: boolean }) => error);
    const saved = saveEditSettings(8, settings(20));
    const error = await failed;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { latest?: boolean }).message).toBe("Kaputt");
    expect((error as Error & { latest?: boolean }).latest).toBe(false);
    expect((await saved).latest).toBe(true);
  });
});
