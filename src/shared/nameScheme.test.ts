import { describe, expect, test } from "bun:test";
import { applyNameScheme } from "./nameScheme";

describe("applyNameScheme", () => {
  test("replaces every {n} and {m}", () => {
    expect(applyNameScheme("bw scans {n}/{m}", 2, 5)).toBe("bw scans 2/5");
    expect(applyNameScheme("{n}-{n} von {m} ", 1, 1)).toBe("1-1 von 1");
  });

  test("pads {n} with zeros to the width of {m}", () => {
    expect(applyNameScheme("Scan {n}/{m}", 9, 9)).toBe("Scan 9/9");
    expect(applyNameScheme("Scan {n}/{m}", 1, 10)).toBe("Scan 01/10");
    expect(applyNameScheme("Scan {n}", 42, 100)).toBe("Scan 042");
    expect(applyNameScheme("Scan {n}", 1000, 1000)).toBe("Scan 1000");
  });

  test("keeps names without placeholders", () => {
    expect(applyNameScheme("Rechnung", 3, 4)).toBe("Rechnung");
  });
});
