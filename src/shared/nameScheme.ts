/**
 * A name for the n-th of m documents: `{n}` becomes its number (from 1, padded with zeros to the width of m, so names
 * sort by number), `{m}` the number of documents.
 */
export function applyNameScheme(scheme: string, n: number, m: number): string {
  return scheme.replaceAll("{n}", String(n).padStart(String(m).length, "0")).replaceAll("{m}", String(m)).trim();
}
