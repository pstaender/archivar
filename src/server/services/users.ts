import type { Database } from "bun:sqlite";
import { MIN_PASSWORD_LENGTH } from "../../shared/auth";
import type { User } from "../../shared/types";
import { UserRepository } from "../db/users";
import { derivedKeys, type FileStorage } from "../storage";

export const MAX_USER_NAME_LENGTH = 64;

/** Users are managed with `scripts/users.ts`; throws an Error with a German message for the command line. */
export async function createUser(users: UserRepository, name: string, password: string, admin: boolean): Promise<User> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Der Benutzername darf nicht leer sein.");
  if (/\s/.test(trimmed)) throw new Error("Der Benutzername darf keine Leerzeichen enthalten.");
  if (trimmed.length > MAX_USER_NAME_LENGTH) throw new Error(`Der Benutzername darf höchstens ${MAX_USER_NAME_LENGTH} Zeichen haben.`);
  if (users.findByName(trimmed)) throw new Error(`Den Benutzer „${trimmed}“ gibt es schon.`);
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Das Kennwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  return users.create(trimmed, await Bun.password.hash(password), admin);
}

export function documentCount(db: Database, userId: number): number {
  return (db.query("SELECT COUNT(*) AS count FROM documents WHERE user_id = ?").get(userId) as { count: number }).count;
}

/** Deletes the user with all its data and stored files; returns the number of deleted documents. */
export async function deleteUser(db: Database, storage: FileStorage, userId: number): Promise<number> {
  const documents = db.query("SELECT id, storage_key AS storageKey FROM documents WHERE user_id = ?").all(userId) as { id: number; storageKey: string }[];
  if (!new UserRepository(db).delete(userId)) throw new Error("Benutzer nicht gefunden.");
  const inUse = db.query("SELECT 1 FROM documents WHERE storage_key = ? LIMIT 1");
  for (const doc of documents) {
    if (inUse.get(doc.storageKey) === null) await storage.delete(doc.storageKey);
    await storage.delete(derivedKeys.dir(doc.id));
  }
  return documents.length;
}
