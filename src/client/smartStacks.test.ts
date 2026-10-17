import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../shared/types";
import { docItem, makeDocument, makeStack, stackItem } from "../../test/client";
import { groupSmartStacks, nameSimilarity, seriesName, similarityThreshold, similarNames, type SmartStack } from "./smartStacks";

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 17, 10, 0) + minutes * 60_000).toISOString();
const doc = (id: number, title: string, minutes: number) => docItem(makeDocument({ id, title, createdAt: at(minutes) }));
const shape = (items: ReturnType<typeof groupSmartStacks>) =>
  items.map((item) => (item.type === "smart" ? `${item.reason}:${item.title}:${item.documents.map((d) => d.id).join(",")}` : item.type === "stack" ? `stack` : item.document.id));

describe("smart stacks", () => {
  test("read numbered names", () => {
    expect(seriesName("Scan 003")).toEqual({ prefix: "scan", label: "Scan", number: 3 });
    expect(seriesName("IMG_9816")).toMatchObject({ prefix: "img", number: 9816 });
    expect(seriesName("Brief (2)")).toMatchObject({ prefix: "brief", number: 2 });
    expect(seriesName("Vertrag Seite 4")).toMatchObject({ prefix: "vertrag", number: 4 });
    expect(seriesName("0001")).toMatchObject({ prefix: "", number: 1 });
    expect(seriesName("Rechnung")).toBeNull();
    expect(seriesName("scan_600dpi_20260823_143439_000261")).toEqual({ prefix: "scan_#dpi_#_#", label: "scan_600dpi_20260823_143439", number: 261 });
  });

  test("a counter at the end makes a series even when the scan time in the name changes", () => {
    const items: LibraryItem[] = [
      doc(1, "scan_600dpi_20260823_143439_000261", 0),
      doc(2, "scan_600dpi_20260823_143624_000266", 1.6),
      doc(3, "scan_600dpi_20260823_143624_000265", 1.7),
      doc(4, "scan_600dpi_20260823_143624_000264", 1.8),
      doc(5, "scan_600dpi_20260823_143624_000263", 1.9),
      doc(6, "scan_600dpi_20260823_143439_000262", 2),
    ];
    expect(shape(groupSmartStacks(items))).toEqual(["name:scan_600dpi_20260823_143439 …:1,6,5,4,3,2"]);
  });

  test("a series has to be uploaded as a chain, each file at most two minutes after the previous one", () => {
    const items: LibraryItem[] = [doc(1, "Scan 1", 0), doc(2, "Scan 2", 1.9), doc(3, "Scan 3", 3.8), doc(4, "Scan 4", 6), doc(5, "Scan 5", 7)];
    expect(shape(groupSmartStacks(items))).toEqual(["name:Scan …:1,2,3", "name:Scan …:4,5"]);
  });

  test("files uploaded together need matching names", () => {
    const items: LibraryItem[] = [doc(1, "IMG_0010", 0), doc(2, "Brief", 0.5), doc(3, "IMG_0011", 1), doc(4, "Anlage", 1.5), doc(5, "IMG_0012", 600)];
    expect(shape(groupSmartStacks(items))).toEqual(["name:IMG …:1,3", 2, 4, 5]);
  });

  test("split a series at larger gaps in its numbers", () => {
    const items: LibraryItem[] = [doc(1, "Scan 1", 0), doc(2, "Scan 2", 0.5), doc(3, "Scan 3", 1), doc(4, "Scan 40", 1.5)];
    expect(shape(groupSmartStacks(items))).toEqual(["name:Scan …:1,2,3", 4]);
  });

  test("keep real stacks and the library order, and place a smart stack where its first document was", () => {
    const items: LibraryItem[] = [doc(5, "Notiz", 100), stackItem(makeStack({ id: 9 })), doc(4, "IMG_0011", 1), doc(3, "IMG_0010", 0)];
    expect(shape(groupSmartStacks(items))).toEqual([5, "stack", "name:IMG …:3,4"]);
  });

  test("need 80 % of a short name to match, down to 60 % for long ones", () => {
    expect(similarityThreshold(5)).toBe(0.8);
    expect(similarityThreshold(19)).toBeCloseTo(0.7);
    expect(similarityThreshold(40)).toBeCloseTo(0.6);
    expect(nameSimilarity("rechnung januar", "rechnung juni")).toBeCloseTo(1 - 4 / 15);
    expect(similarNames("Rechnung Telekom Januar", "Rechnung Telekom Februar")).toBe(true);
    expect(similarNames("Kontoauszug März", "Kontoauszug Mai")).toBe(true);
    expect(similarNames("Brief", "Bild")).toBe(false);
    expect(similarNames("Vertrag Miete", "Rechnung Strom")).toBe(false);
    // Only digits differ: that is for the series rule, else a scanner's files would all look alike.
    expect(similarNames("scan_20260823_143439_000261", "scan_20260901_091500_000990")).toBe(false);
  });

  test("group similar names that are no numbered series, in name order", () => {
    const items: LibraryItem[] = [
      doc(1, "Rechnung Telekom März", 0),
      doc(2, "Urlaubsfoto", 0.5),
      doc(3, "Rechnung Telekom Januar", 1),
      doc(4, "Rechnung Telekom Februar", 1.5),
      doc(5, "Mietvertrag", 2),
    ];
    expect(shape(groupSmartStacks(items))).toEqual(["similar:Rechnung Telekom …:4,3,1", 2, 5]);
  });

  test("similar names uploaded far apart stay apart", () => {
    const items: LibraryItem[] = [doc(1, "Rechnung Telekom Januar", 0), doc(2, "Rechnung Telekom Februar", 60)];
    expect(shape(groupSmartStacks(items))).toEqual([1, 2]);
  });

  test("scanner files far apart in their counter stay apart", () => {
    const items: LibraryItem[] = [doc(1, "scan_20260823_143439_000261", 0), doc(2, "scan_20260901_091500_000990", 1)];
    expect(shape(groupSmartStacks(items))).toEqual([1, 2]);
  });

  test("leaves single documents alone", () => {
    expect(shape(groupSmartStacks([doc(1, "Scan 1", 0), doc(2, "Brief", 60)]))).toEqual([1, 2]);
  });
});
