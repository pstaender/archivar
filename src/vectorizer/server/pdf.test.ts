import { expect, test } from "bun:test";
import { DEFAULT_VECTOR_SETTINGS } from "../settings";
import { pathOperators, pdfColor, vectorAreasPdfOperators } from "./pdf";

test("turns SVG path data into PDF path operators", () => {
  expect(pathOperators("M5 5L35 5L35 25ZM1.5 -2C1 2 3 4 5 6Z")).toBe("5 5 m\n35 5 l\n35 25 l\nh\n1.5 -2 m\n1 2 3 4 5 6 c\nh");
  expect(pathOperators("M0 0 10 0 10 10Z")).toBe("0 0 m\n10 0 l\n10 10 l\nh");
  expect(pathOperators("M1.26 -0.04L2.5 3Z", 1)).toBe("1.3 0 m\n2.5 3 l\nh");
});

test("converts colors", () => {
  expect(pdfColor("#ff0080")).toBe("1 0 0.502");
});

test("maps each graphic onto its pixel rectangle with the y axis pointing up and clips it there", () => {
  const graphic = { width: 10, height: 20, background: "#ffffff", paths: [{ d: "M0 0L5 0L5 20Z", fill: "#000000" }] };
  const ops = vectorAreasPdfOperators(
    [
      { id: "a", x: 0.5, y: 0.25, width: 0.5, height: 0.5, settings: DEFAULT_VECTOR_SETTINGS, graphic },
      { id: "b", x: 0, y: 0, width: 0.2, height: 0.2, settings: DEFAULT_VECTOR_SETTINGS, graphic: null },
    ],
    200,
    100,
    400,
    200,
  ).split("\n");
  // 100 × 50 pixels at (100, 25), on a page twice the image's size.
  expect(ops.slice(0, 5)).toEqual(["q", "20 0 0 -5 200 150 cm", "0 0 10 20 re W n", "1 1 1 rg", "0 0 10 20 re f"]);
  expect(ops.slice(5)).toEqual(["0 0 0 rg", "0 0 m", "5 0 l", "5 20 l", "h", "f", "Q"]);
});

test("rounds coordinates to what the page can show", () => {
  const graphic = { width: 1000, height: 1000, background: "#ffffff", paths: [{ d: "M0.26 0L500.44 0L500.44 1000Z", fill: "#000000" }] };
  const area = { id: "a", x: 0, y: 0, width: 1, height: 1, settings: DEFAULT_VECTOR_SETTINGS, graphic };
  // 0.1 pt per unit: whole units.
  expect(vectorAreasPdfOperators([area], 1000, 1000, 100, 100)).toContain("\n0 0 m\n500 0 l\n");
  // 1 pt per unit: tenths.
  expect(vectorAreasPdfOperators([area], 1000, 1000, 1000, 1000)).toContain("\n0.3 0 m\n500.4 0 l\n");
});
