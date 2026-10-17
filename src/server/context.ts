import type { Database } from "bun:sqlite";
import type { User } from "../shared/types";
import { DEFAULT_USER_NAME } from "./db/database";
import { DocumentRepository } from "./db/documents";
import { FolderRepository } from "./db/folders";
import { PresetRepository } from "./db/presets";
import { StackRepository } from "./db/stacks";
import { UserRepository } from "./db/users";
import { HttpError } from "./http";
import { ArchiveService } from "./services/archive";
import type { DewarpEngine } from "./services/dewarp";
import { ImagingService } from "./services/imaging";
import type { ImageConverter } from "./services/magick";
import { type OcrEngine, OcrQueue } from "./services/ocr";
import { FileStorage } from "./storage";

export interface AppContext {
  db: Database;
  storage: FileStorage;
  users: UserRepository;
  folders: FolderRepository;
  documents: DocumentRepository;
  stacks: StackRepository;
  presets: PresetRepository;
  ocr: OcrQueue;
  dewarp: DewarpEngine;
  imaging: ImagingService;
  ocrEngine: OcrEngine;
  archive: ArchiveService;
  currentUser(req: Request): User;
}

export interface ContextOptions {
  db: Database;
  storageDir: string;
  ocrEngine: OcrEngine;
  dewarpEngine: DewarpEngine;
  imageConverter?: ImageConverter | null;
  ocrPageTimeoutMs?: number;
}

export function createContext(options: ContextOptions): AppContext {
  const { db } = options;
  const storage = new FileStorage(options.storageDir);
  const users = new UserRepository(db);
  const folders = new FolderRepository(db);
  const documents = new DocumentRepository(db, folders);
  const stacks = new StackRepository(db, folders);
  const presets = new PresetRepository(db);
  const imaging = new ImagingService(storage, options.imageConverter ?? null);
  const ocr = new OcrQueue(documents, imaging, options.ocrEngine, options.ocrPageTimeoutMs);
  const dewarp = options.dewarpEngine;
  const archive = new ArchiveService(documents, stacks, folders, storage, imaging, ocr, dewarp, options.ocrEngine);

  // Authentication is not implemented yet: every request acts as the default user.
  const currentUser = (_req: Request): User => {
    const user = users.findByName(DEFAULT_USER_NAME);
    if (!user) throw new HttpError(500, "Default user missing");
    return user;
  };

  return { db, storage, users, folders, documents, stacks, presets, ocr, ocrEngine: options.ocrEngine, dewarp, imaging, archive, currentUser };
}
