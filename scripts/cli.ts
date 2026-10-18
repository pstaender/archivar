// Prompts shared by the command line scripts.

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads one line without echoing it. */
export function readHidden(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

export async function readNewPassword(): Promise<string> {
  if (!process.stdin.isTTY) return (await Bun.stdin.text()).replace(/\r?\n$/, "");
  const password = await readHidden("Neues Kennwort: ");
  if ((await readHidden("Kennwort wiederholen: ")) !== password) fail("Die Kennwörter stimmen nicht überein.");
  return password;
}

/** Asks for a line of text; null when stdin is closed. */
export function ask(question: string): string | null {
  return prompt(question)?.trim() ?? null;
}

/** y/n question; `fallback` is used for an empty answer. */
export function askYesNo(question: string, fallback: boolean): boolean {
  const answer = ask(`${question} [${fallback ? "J/n" : "j/N"}]`);
  if (!answer) return fallback;
  return /^(j|ja|y|yes)$/i.test(answer);
}
