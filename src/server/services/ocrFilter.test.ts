import { describe, expect, test } from "bun:test";
import { allOcrLines, filterOcrText, isGarbageLine, isGarbageWord, type OcrLine, type OcrParagraph } from "./ocrFilter";

function line(spec: string, confidence?: number): OcrLine {
  const words = spec.split(" ").map((token) => {
    const [, text, conf] = token.match(/^(.*)\((\d+)\)$/)!;
    return { text: text!, confidence: Number(conf) };
  });
  return { words, confidence: confidence ?? words.reduce((s, w) => s + w.confidence, 0) / words.length };
}

// Recorded from tesseract.js on a photographed, curved page.
const curvedPage: OcrParagraph[] = [
  [line("AUfvergrag(0)", 0)],
  [line("d(93)", 93)],
  [line("ann(95) un(95)", 95)],
  [
    line("Wische,,(12) Herr,(80) Max(93) mig(41) ender(96)", 64),
    line("Very,(64) ag(96) I(41) Schlosser(31) Seon(0) hrrads(93) zum(96)", 57),
    line("Preis(83) Von(92) 450,09(82) EUR.(91) Die(95) i(31) ist(96)", 82),
    line("Scho(0) -(47)", 19),
    line("=a(44) nn(50) -(74) LL(14)", 45),
    line("ZI(9) a(12) -(68) J(38)", 32),
  ],
];

describe("OCR filter", () => {
  test("removes noise lines and garbage words from a poorly recognized page", () => {
    const { text, removed } = filterOcrText(curvedPage);
    expect(text).toBe(
      ["ann un", "Herr, Max mig ender\nVery, ag I Schlosser hrrads zum\nPreis Von 450,09 EUR. Die i ist"].join("\n\n"),
    );
    expect(removed).toBe(7);
  });

  test("keeps a cleanly recognized document untouched", () => {
    const clean: OcrParagraph[] = [
      [line("Mietvertrag(96)")],
      [line("Rechnungsnummer:(91) 2026-0412(95)"), line("Betrag:(96) 1.234,56(96) EUR(96)")],
      [line("Seite(90) 2(88)"), line("3(92)")],
    ];
    const { text, removed } = filterOcrText(clean);
    expect(removed).toBe(0);
    expect(text).toBe("Mietvertrag\n\nRechnungsnummer: 2026-0412\nBetrag: 1.234,56 EUR\n\nSeite 2\n3");
  });

  test("line rules", () => {
    expect(isGarbageLine(line("Hallo(40) Welt(40)"))).toBe(true);
    expect(isGarbageLine(line("~~(90) //(90) Ab(90)"))).toBe(true);
    expect(isGarbageLine(line("ab(90) cd(90)"))).toBe(true);
    expect(isGarbageLine(line("7(60)"))).toBe(true);
    expect(isGarbageLine(line("Hallo(90)"))).toBe(false);
  });

  test("word rules", () => {
    expect(isGarbageWord({ text: "Seon", confidence: 5 })).toBe(true);
    expect(isGarbageWord({ text: "|", confidence: 46 })).toBe(true);
    expect(isGarbageWord({ text: "–", confidence: 80 })).toBe(false);
    expect(isGarbageWord({ text: "Schlosser", confidence: 31 })).toBe(false);
  });

  test("keeps the position of each kept line", () => {
    const box = (y: number) => ({ x0: 10, y0: y, x1: 300, y1: y + 20 });
    const paragraphs: OcrParagraph[] = [
      [{ ...line("Rechnung(95)"), bbox: box(0) }, { ...line("~~(5)"), bbox: box(30) }],
      [{ ...line("Betrag(90) 12(92) %%(10)"), bbox: box(60) }],
    ];
    expect(filterOcrText(paragraphs).lines).toEqual([
      { text: "Rechnung", bbox: box(0) },
      { text: "Betrag 12", bbox: box(60) },
    ]);
    expect(allOcrLines(paragraphs).map((l) => [l.text, l.bbox?.y0])).toEqual([
      ["Rechnung", 0],
      ["~~", 30],
      ["Betrag 12 %%", 60],
    ]);
  });
});
