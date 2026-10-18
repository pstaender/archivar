import { describe, expect, test } from "bun:test";
import { applyNameScheme } from "./nameScheme";

describe("applyNameScheme", () => {
  test("replaces every {n} and {m}", () => {
    expect(applyNameScheme("bw scans {n}/{m}", 2, 5)).toBe("bw scans 2/5");
    expect(applyNameScheme("{n}-{n} von {m} ", 1, 1)).toBe("1-1 von 1");
  });

  test("keeps names without placeholders", () => {
    expect(applyNameScheme("Rechnung", 3, 4)).toBe("Rechnung");
  });
});
