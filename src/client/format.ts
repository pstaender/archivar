import type { ArchiveDocument, OcrStatus } from "../shared/types";

const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

const relativeFormat = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
const weekdayFormat = new Intl.DateTimeFormat("de", { weekday: "long" });
const timeFormat = new Intl.DateTimeFormat("de", { hour: "2-digit", minute: "2-digit" });
const RECENT_DAYS = 6;

/**
 * Today relative ("vor 5 Minuten"), the days before with the weekday ("Gestern, 14:30", "Montag, 09:12"),
 * from the seventh day on as date and time.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const seconds = Math.max(0, Math.round((now.getTime() - date.getTime()) / 1000));
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days <= 0) {
    if (seconds < 60) return relativeFormat.format(-seconds, "second");
    if (seconds < 3600) return relativeFormat.format(-Math.floor(seconds / 60), "minute");
    return relativeFormat.format(-Math.floor(seconds / 3600), "hour");
  }
  if (days === 1) return `Gestern, ${timeFormat.format(date)}`;
  if (days <= RECENT_DAYS) return `${weekdayFormat.format(date)}, ${timeFormat.format(date)}`;
  return formatDateTime(iso);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export const OCR_STATUS_LABEL: Record<OcrStatus, string> = {
  none: "Kein Text erkannt",
  pending: "Texterkennung wartet",
  running: "Texterkennung läuft",
  done: "Text erkannt",
  failed: "Texterkennung fehlgeschlagen",
};

export function isOcrBusy(doc: Pick<ArchiveDocument, "ocrStatus">): boolean {
  return doc.ocrStatus === "pending" || doc.ocrStatus === "running";
}

export function documentLabel(doc: ArchiveDocument): string {
  return doc.title || doc.originalName;
}
