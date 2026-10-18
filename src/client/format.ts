import type { ArchiveDocument, OcrStatus } from "../shared/types";
import { locale, t } from "./i18n";

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

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
  const relativeFormat = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const time = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(date);
  if (days <= 0) {
    if (seconds < 60) return relativeFormat.format(-seconds, "second");
    if (seconds < 3600) return relativeFormat.format(-Math.floor(seconds / 60), "minute");
    return relativeFormat.format(-Math.floor(seconds / 3600), "hour");
  }
  if (days === 1) return t("format.yesterday", { time });
  if (days <= RECENT_DAYS) return t("format.weekdayTime", { weekday: new Intl.DateTimeFormat(locale(), { weekday: "long" }).format(date), time });
  return formatDateTime(iso);
}

const unit = (count: number, name: "seconds" | "minutes" | "hours") => t(`format.${name}`, { count });

/** E.g. "45 Sekunden", "2 Minuten 5 Sekunden" (seconds only below 10 minutes), "1 Stunde 20 Minuten". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return unit(seconds, "seconds");
  if (seconds < 600) {
    const rest = seconds % 60;
    const minutes = unit(Math.floor(seconds / 60), "minutes");
    return rest ? `${minutes} ${unit(rest, "seconds")}` : minutes;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return unit(minutes, "minutes");
  const rest = minutes % 60;
  const hours = unit(Math.floor(minutes / 60), "hours");
  return rest ? `${hours} ${unit(rest, "minutes")}` : hours;
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
  return `${value.toLocaleString(locale(), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

/** The name of an OCR language (Tesseract code) in the UI language. */
export function ocrLanguageName(code: string): string {
  return t(`ocrLanguages.${code}`, { defaultValue: code });
}

export function ocrStatusLabel(status: OcrStatus): string {
  return t(`ocrStatus.${status}`);
}

export function isOcrBusy(doc: Pick<ArchiveDocument, "ocrStatus">): boolean {
  return doc.ocrStatus === "pending" || doc.ocrStatus === "running";
}

export function documentLabel(doc: ArchiveDocument): string {
  return doc.title || doc.originalName;
}
