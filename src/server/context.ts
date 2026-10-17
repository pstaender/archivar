import type { Database } from "bun:sqlite";
import type { User } from "../shared/types";
import { AuthRepository } from "./db/auth";
import { DocumentRepository } from "./db/documents";
import { FolderRepository } from "./db/folders";
import { JobRepository } from "./db/jobs";
import { PresetRepository } from "./db/presets";
import { StackRepository } from "./db/stacks";
import { TokenRepository } from "./db/tokens";
import { UserRepository } from "./db/users";
import { VectorRepository } from "./db/vectors";
import { HttpError } from "./http";
import { ArchiveService } from "./services/archive";
import { AuthService } from "./services/auth";
import type { DewarpEngine } from "./services/dewarp";
import type { DocumentSegmenter } from "./services/documentSegmentation";
import { ImagingService } from "./services/imaging";
import { JobQueue } from "./services/jobs";
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
  jobs: JobRepository;
  tokens: TokenRepository;
  vectors: VectorRepository;
  jobQueue: JobQueue;
  ocr: OcrQueue;
  dewarp: DewarpEngine;
  imaging: ImagingService;
  ocrEngine: OcrEngine;
  archive: ArchiveService;
  auth: AuthService;
  /** Sessions and passkeys. */
  authStore: AuthRepository;
  currentUser(req: Request): User;
}

export interface ContextOptions {
  db: Database;
  storageDir: string;
  ocrEngine: OcrEngine;
  dewarpEngine: DewarpEngine;
  segmenter: DocumentSegmenter;
  imageConverter?: ImageConverter | null;
  ocrPageTimeoutMs?: number;
  origin?: string | null;
}

export function createContext(options: ContextOptions): AppContext {
  const { db } = options;
  const storage = new FileStorage(options.storageDir);
  const users = new UserRepository(db);
  const folders = new FolderRepository(db);
  const documents = new DocumentRepository(db, folders);
  const stacks = new StackRepository(db, folders);
  const presets = new PresetRepository(db);
  const jobs = new JobRepository(db);
  const tokens = new TokenRepository(db);
  const vectors = new VectorRepository(db);
  const imaging = new ImagingService(storage, options.imageConverter ?? null, (doc) => vectors.get(doc.userId, doc.id)?.areas ?? []);
  const ocr = new OcrQueue(documents, imaging, options.ocrEngine, options.ocrPageTimeoutMs);
  const dewarp = options.dewarpEngine;
  const archive = new ArchiveService(documents, stacks, folders, storage, imaging, ocr, dewarp, options.segmenter, options.ocrEngine, vectors);
  const jobQueue = new JobQueue(jobs, archive);
  const authStore = new AuthRepository(db);
  const auth = new AuthService(users, authStore, options.origin);

  // Scripts send a bearer token; browsers get a session cookie when the user has a password.
  const currentUser = (req: Request): User => {
    const bearer = req.headers.get("Authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (bearer) {
      const userId = tokens.authenticate(bearer);
      const user = userId === null ? null : users.find(userId);
      if (!user) throw new HttpError(401, "Invalid API token");
      return user;
    }
    const user = auth.requestUser(req);
    if (!user) throw new HttpError(401, "Login required");
    return user;
  };

  return { db, storage, users, folders, documents, stacks, presets, jobs, tokens, vectors, jobQueue, ocr, ocrEngine: options.ocrEngine, dewarp, imaging, archive, auth, authStore, currentUser };
}
