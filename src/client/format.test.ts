import { expect, test } from "bun:test";
import { formatBytes, isOcrBusy } from "./format";

test("formatBytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(1536)).toBe("1,5 KB");
  expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
});

test("isOcrBusy", () => {
  expect(isOcrBusy({ ocrStatus: "pending" })).toBe(true);
  expect(isOcrBusy({ ocrStatus: "running" })).toBe(true);
  expect(isOcrBusy({ ocrStatus: "done" })).toBe(false);
});
