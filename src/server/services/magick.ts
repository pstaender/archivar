import { CONVERTIBLE_IMAGE_FORMATS } from "../../shared/uploads";

export interface ImageConverter {
  types(): string[];
  toPng(data: Uint8Array, mimeType: string): Promise<Uint8Array>;
}

const CONVERT_TIMEOUT_MS = 120_000;

async function run(cmd: string[], stdin?: Uint8Array): Promise<Uint8Array> {
  const proc = Bun.spawn(cmd, { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe", timeout: CONVERT_TIMEOUT_MS });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`${cmd[0]} failed (${code}): ${stderr.trim()}`);
  return new Uint8Array(stdout);
}

export function readableFormats(listing: string): Set<string> {
  const formats = new Set<string>();
  for (const line of listing.split("\n")) {
    const match = /^\s*([A-Z0-9-]+)\*?\s+\S+\s+r[w-][+-]/.exec(line);
    if (match) formats.add(match[1]!);
  }
  return formats;
}

export class MagickConverter implements ImageConverter {
  private constructor(
    private binary: string,
    private supported: Map<string, string>,
  ) {}

  static async detect(): Promise<MagickConverter | null> {
    // ImageMagick 6 only ships `convert`, which on Windows is a system tool.
    const binary = Bun.which("magick") ?? (process.platform === "win32" ? null : Bun.which("convert"));
    if (!binary) return null;
    try {
      const readable = readableFormats(new TextDecoder().decode(await run([binary, "-list", "format"])));
      const supported = new Map(
        CONVERTIBLE_IMAGE_FORMATS.filter((format) => readable.has(format.coder)).map((format) => [format.mimeType, format.coder]),
      );
      return supported.size > 0 ? new MagickConverter(binary, supported) : null;
    } catch {
      return null;
    }
  }

  types(): string[] {
    return [...this.supported.keys()];
  }

  toPng(data: Uint8Array, mimeType: string): Promise<Uint8Array> {
    const coder = this.supported.get(mimeType);
    if (!coder) throw new Error(`Unsupported image type ${mimeType}`);
    // The explicit coder prefix keeps ImageMagick from guessing (and running) other coders from the content.
    return run([this.binary, `${coder}:-`, "-auto-orient", "-strip", "png:-"], data);
  }
}
