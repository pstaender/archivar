export interface OcrWord {
  text: string;
  confidence: number;
}

export interface OcrLine {
  words: OcrWord[];
  confidence: number;
}

export type OcrParagraph = OcrLine[];

const MIN_LINE_CONFIDENCE = 50;
const MIN_WORD_CONFIDENCE = 20;
const MIN_SYMBOL_WORD_CONFIDENCE = 50;
const MIN_ALNUM_RATIO = 0.5;
const MIN_TOKEN_LENGTH = 3;
const MIN_NUMBER_CONFIDENCE = 80;

const ALNUM = /[\p{L}\p{N}]/gu;

function alnumRatio(text: string): number {
  const compact = text.replace(/\s+/g, "");
  if (!compact) return 0;
  return (compact.match(ALNUM)?.length ?? 0) / compact.length;
}

function hasRealToken(words: OcrWord[]): boolean {
  return words.some(
    (w) =>
      (w.text.match(ALNUM)?.length ?? 0) >= MIN_TOKEN_LENGTH ||
      (/\p{N}/u.test(w.text) && w.confidence >= MIN_NUMBER_CONFIDENCE),
  );
}

export function isGarbageWord(word: OcrWord): boolean {
  if (word.confidence < MIN_WORD_CONFIDENCE) return true;
  return word.confidence < MIN_SYMBOL_WORD_CONFIDENCE && alnumRatio(word.text) < MIN_ALNUM_RATIO;
}

export function isGarbageLine(line: OcrLine): boolean {
  const text = line.words.map((w) => w.text).join(" ");
  return line.confidence < MIN_LINE_CONFIDENCE || alnumRatio(text) < MIN_ALNUM_RATIO || !hasRealToken(line.words);
}

/** Drops lines (and isolated words) that are most likely misread noise, e.g. image borders or textures. */
export function filterOcrText(paragraphs: OcrParagraph[]): { text: string; removed: number } {
  let removed = 0;
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const lines: string[] = [];
    for (const line of paragraph) {
      if (isGarbageLine(line)) {
        removed++;
        continue;
      }
      const words = line.words.filter((w) => !isGarbageWord(w));
      removed += line.words.length - words.length;
      lines.push(words.map((w) => w.text).join(" "));
    }
    if (lines.length > 0) kept.push(lines.join("\n"));
  }
  return { text: kept.join("\n\n").trim(), removed };
}
