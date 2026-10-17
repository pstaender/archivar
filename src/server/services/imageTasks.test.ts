import { describe, expect, test } from "bun:test";
import { makeJpeg } from "../../../test/server";
import { DEFAULT_EDIT_SETTINGS as settings } from "../../shared/editSettings";
import { imageWorker } from "./imageTasks";

describe("image worker", () => {
  test("runs tasks in the worker", async () => {
    expect(await imageWorker.run("size", { data: await makeJpeg(64, 48) })).toEqual({ width: 64, height: 48 });
  });

  test("passes errors back", async () => {
    await expect(imageWorker.run("size", { data: new Uint8Array([1, 2, 3]) })).rejects.toThrow();
    expect(await imageWorker.run("size", { data: await makeJpeg(10, 20) })).toEqual({ width: 10, height: 20 });
  });

  test("reuses the decoded image only for the same key", async () => {
    const upright = await imageWorker.run("upright", { source: { key: "a", data: await makeJpeg(64, 48) }, rotation: 90 });
    expect([upright.width, upright.height]).toEqual([48, 64]);
    const other = await imageWorker.run("upright", { source: { key: "b", data: await makeJpeg(30, 20) }, rotation: 0 });
    expect([other.width, other.height]).toEqual([30, 20]);
    const jpeg = await imageWorker.run("renderJpeg", { source: { key: "b", data: await makeJpeg(30, 20) }, settings });
    expect(jpeg.length).toBeGreaterThan(0);
  });
});
