// The API answers in English only. The client translates a message by a key made of its text without the variable
// parts: quoted names (a run like `"a", "b"` counts as one) and numbers become the values q0, q1 … and n0, n1 ….

const QUOTED_LIST = /"[^"]*"(?:, "[^"]*")*/g;

export interface ServerMessageParts {
  /** E.g. `could_not_be_read_as_a_pdf` for `"scan.pdf" could not be read as a PDF`. */
  key: string;
  quoted: string[][];
  numbers: string[];
}

export function serverMessageParts(message: string): ServerMessageParts {
  const quoted: string[][] = [];
  const numbers: string[] = [];
  const text = message
    .replace(QUOTED_LIST, (list) => {
      quoted.push([...list.matchAll(/"([^"]*)"/g)].map((match) => match[1]!));
      return " ";
    })
    .replace(/\d+/g, (number) => {
      numbers.push(number);
      return " ";
    });
  return { key: text.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, ""), quoted, numbers };
}
