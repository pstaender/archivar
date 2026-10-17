import { expect, test } from "bun:test";
import { formatBytes, formatDateTime, formatRelativeTime, isOcrBusy } from "./format";

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

test("formatRelativeTime counts back today, names the weekday within six days and shows the date after that", () => {
  const now = new Date(2026, 9, 15, 12, 0, 0); // Thursday
  const at = (...args: [number, number, number, number, number, number?]) => new Date(...args).toISOString();
  expect(formatRelativeTime(at(2026, 9, 15, 12, 0, 0), now)).toBe("jetzt");
  expect(formatRelativeTime(at(2026, 9, 15, 11, 59, 35), now)).toBe("vor 25 Sekunden");
  expect(formatRelativeTime(at(2026, 9, 15, 11, 3, 0), now)).toBe("vor 57 Minuten");
  expect(formatRelativeTime(at(2026, 9, 15, 0, 30, 0), now)).toBe("vor 11 Stunden");
  expect(formatRelativeTime(at(2026, 9, 14, 23, 50, 0), now)).toBe("Gestern, 23:50");
  expect(formatRelativeTime(at(2026, 9, 12, 9, 5, 0), now)).toBe("Montag, 09:05");
  expect(formatRelativeTime(at(2026, 9, 9, 9, 5, 0), now)).toBe("Freitag, 09:05");
  expect(formatRelativeTime(at(2026, 9, 8, 9, 5, 0), now)).toBe(formatDateTime(at(2026, 9, 8, 9, 5, 0)));
});
