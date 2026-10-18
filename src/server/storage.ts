import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { PREVIEW_SIZE } from "../shared/preview";
import { HttpError } from "./http";

export class FileStorage {
  constructor(readonly root: string) {}

  path(key: string): string {
    const full = normalize(join(this.root, key));
    if (!full.startsWith(normalize(this.root))) throw new HttpError(400, "Invalid storage key");
    return full;
  }

  async write(key: string, data: Uint8Array | ArrayBuffer | Blob): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, data);
  }

  file(key: string) {
    return Bun.file(this.path(key));
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await this.file(key).arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    return this.file(key).exists();
  }

  /** Copies a file or directory; a missing source copies nothing. */
  async copy(from: string, to: string): Promise<void> {
    try {
      await cp(this.path(from), this.path(to), { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { recursive: true, force: true });
  }

  /** Keys of the stored files matching a glob pattern (relative to the storage root). */
  async list(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    try {
      for await (const key of new Bun.Glob(pattern).scan({ cwd: this.root })) keys.push(key.replaceAll("\\", "/"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return keys;
  }
}

export const derivedKeys = {
  dir: (documentId: number) => `derived/${documentId}`,
  source: (documentId: number) => `derived/${documentId}/source.png`,
  preview: (documentId: number) => `derived/${documentId}/preview-${PREVIEW_SIZE}.jpg`,
  anyPreview: "derived/*/preview*.jpg",
  processed: (documentId: number) => `derived/${documentId}/processed.jpg`,
  /** The edited image without its shapes and vector areas; only exists while it has some. */
  edited: (documentId: number) => `derived/${documentId}/edited.jpg`,
  thumbnail: (documentId: number) => `derived/${documentId}/thumbnail.jpg`,
};
