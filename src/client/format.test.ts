import { expect, test } from "bun:test";
import { formatBytes, formatDateTime, formatDuration, formatRelativeTime, isOcrBusy, ocrLanguageName } from "./format";
import { i18n } from "./i18n";

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

test("formatDuration shows seconds, minutes and hours", () => {
  expect(formatDuration(200)).toBe("1 Sekunde");
  expect(formatDuration(45_000)).toBe("45 Sekunden");
  expect(formatDuration(60_000)).toBe("1 Minute");
  expect(formatDuration(125_000)).toBe("2 Minuten 5 Sekunden");
  expect(formatDuration(14 * 60_000 + 40_000)).toBe("15 Minuten");
  expect(formatDuration(80 * 60_000)).toBe("1 Stunde 20 Minuten");
  expect(formatDuration(2 * 3_600_000)).toBe("2 Stunden");
});

test("formats in the interface language", async () => {
  await i18n.changeLanguage("en");
  expect(formatDuration(125_000)).toBe("2 minutes 5 seconds");
  expect(formatBytes(1536)).toBe("1.5 KB");
  const now = new Date(2026, 5, 10, 12, 0);
  expect(formatRelativeTime(new Date(2026, 5, 9, 9, 5).toISOString(), now)).toBe("Yesterday, 09:05 AM");
  expect(ocrLanguageName("fra")).toBe("French");
});
