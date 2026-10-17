import { describe, expect, test } from "bun:test";
import type { LibraryItem } from "../shared/types";
import { docItem, makeDocument, makeStack, stackItem } from "../../test/client";
import { groupSmartStacks, seriesName, type SmartStack } from "./smartStacks";

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
      doc(2, "scan_600dpi_20260823_143624_000266", 46),
      doc(3, "scan_600dpi_20260823_143624_000265", 47),
      doc(4, "scan_600dpi_20260823_143624_000264", 48),
      doc(5, "scan_600dpi_20260823_143624_000263", 49),
      doc(6, "scan_600dpi_20260823_143439_000262", 50),
    ];
    expect(shape(groupSmartStacks(items))).toEqual(["name:scan_600dpi_20260823_143439 …:1,6,5,4,3,2"]);
  });

  test("uploads keep forming one group as long as each follows the previous within two minutes", () => {
    const items: LibraryItem[] = [doc(1, "Brief", 0), doc(2, "Anlage", 1.9), doc(3, "Foto", 3.8), doc(4, "Notiz", 5.7), doc(5, "Später", 8)];
    expect(shape(groupSmartStacks(items))).toEqual(["time:" + (groupSmartStacks(items)[0] as SmartStack).title + ":1,2,3,4", 5]);
  });

  test("group numbered series by name, whenever they were uploaded, and split them at larger gaps", () => {
    const items: LibraryItem[] = [doc(1, "Scan 1", 0), doc(2, "Rechnung", 600), doc(3, "Scan 2", 300), doc(4, "Scan 3", 900), doc(5, "Scan 40", 1200)];
    expect(shape(groupSmartStacks(items))).toEqual(["name:Scan …:1,3,4", 2, 5]);
  });

  test("group files uploaded right after each other that are no series", () => {
    const items: LibraryItem[] = [doc(1, "Brief", 0), doc(2, "Anlage", 1), doc(3, "Foto", 2.5), doc(4, "Später", 30)];
    const [first, ...rest] = groupSmartStacks(items);
    expect((first as SmartStack).reason).toBe("time");
    expect((first as SmartStack).documents.map((d) => d.id)).toEqual([1, 2, 3]);
    expect((first as SmartStack).title).toStartWith("Hochgeladen ");
    expect(shape(rest)).toEqual([4]);
  });

  test("keep real stacks and the library order, and place a smart stack where its first document was", () => {
    const items: LibraryItem[] = [doc(5, "Notiz", 100), stackItem(makeStack({ id: 9 })), doc(4, "IMG_0011", 50), doc(3, "IMG_0010", 0)];
    expect(shape(groupSmartStacks(items))).toEqual([5, "stack", "name:IMG …:3,4"]);
  });

  test("leaves single documents alone", () => {
    expect(shape(groupSmartStacks([doc(1, "Scan 1", 0), doc(2, "Brief", 60)]))).toEqual([1, 2]);
  });
});
