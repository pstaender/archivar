import type { ArchiveDocument, OcrStatus } from "../shared/types";

const dateFormat = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
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
