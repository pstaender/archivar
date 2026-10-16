import type { Database } from "bun:sqlite";
import type { User } from "../shared/types";
import { DEFAULT_USER_NAME } from "./db/database";
import { DocumentRepository } from "./db/documents";
import { FolderRepository } from "./db/folders";
import { StackRepository } from "./db/stacks";
import { UserRepository } from "./db/users";
import { HttpError } from "./http";
import { ArchiveService } from "./services/archive";
import { ImagingService } from "./services/imaging";
import { type OcrEngine, OcrQueue } from "./services/ocr";
import { FileStorage } from "./storage";

export interface AppContext {
  db: Database;
  storage: FileStorage;
  users: UserRepository;
  folders: FolderRepository;
  documents: DocumentRepository;
  stacks: StackRepository;
  ocr: OcrQueue;
  archive: ArchiveService;
  currentUser(req: Request): User;
}

export function createContext(options: { db: Database; storageDir: string; ocrEngine: OcrEngine }): AppContext {
  const { db } = options;
  const storage = new FileStorage(options.storageDir);
  const users = new UserRepository(db);
  const folders = new FolderRepository(db);
  const documents = new DocumentRepository(db, folders);
  const stacks = new StackRepository(db, folders);
  const imaging = new ImagingService(storage);
  const ocr = new OcrQueue(documents, imaging, options.ocrEngine);
  const archive = new ArchiveService(documents, stacks, folders, storage, imaging, ocr);

  // Authentication is not implemented yet: every request acts as the default user.
  const currentUser = (_req: Request): User => {
    const user = users.findByName(DEFAULT_USER_NAME);
    if (!user) throw new HttpError(500, "Default user missing");
    return user;
  };

  return { db, storage, users, folders, documents, stacks, ocr, archive, currentUser };
}
