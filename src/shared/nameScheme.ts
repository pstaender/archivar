/** A name for the n-th of m documents: `{n}` becomes its number (from 1), `{m}` the number of documents. */
export function applyNameScheme(scheme: string, n: number, m: number): string {
  return scheme.replaceAll("{n}", String(n)).replaceAll("{m}", String(m)).trim();
}
