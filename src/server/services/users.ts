import type { Database } from "bun:sqlite";
import { MIN_PASSWORD_LENGTH } from "../../shared/auth";
import type { User } from "../../shared/types";
import { UserRepository } from "../db/users";
import { derivedKeys, type FileStorage } from "../storage";

export const MAX_USER_NAME_LENGTH = 64;

/**
 * Users are managed with `scripts/users.ts`; throws an Error with a message for the command line. An empty
 * password creates a user without one.
 */
export async function createUser(users: UserRepository, name: string, password: string, admin: boolean): Promise<User> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("The user name must not be empty.");
  if (/\s/.test(trimmed)) throw new Error("The user name must not contain spaces.");
  if (trimmed.length > MAX_USER_NAME_LENGTH) throw new Error(`The user name may have at most ${MAX_USER_NAME_LENGTH} characters.`);
  if (users.findByName(trimmed)) throw new Error(`The user "${trimmed}" already exists.`);
  if (password && password.length < MIN_PASSWORD_LENGTH) throw new Error(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  return users.create(trimmed, password ? await Bun.password.hash(password) : null, admin);
}

export function documentCount(db: Database, userId: number): number {
  return (db.query("SELECT COUNT(*) AS count FROM documents WHERE user_id = ?").get(userId) as { count: number }).count;
}

/** Deletes the user with all its data and stored files; returns the number of deleted documents. A single user left is admin. */
export async function deleteUser(db: Database, storage: FileStorage, userId: number): Promise<number> {
  const documents = db.query("SELECT id, storage_key AS storageKey FROM documents WHERE user_id = ?").all(userId) as { id: number; storageKey: string }[];
  const users = new UserRepository(db);
  if (!users.delete(userId)) throw new Error("User not found.");
  const remaining = users.list();
  if (remaining.length === 1) users.setAdmin(remaining[0]!.id, true);
  const inUse = db.query("SELECT 1 FROM documents WHERE storage_key = ? LIMIT 1");
  for (const doc of documents) {
    if (inUse.get(doc.storageKey) === null) await storage.delete(doc.storageKey);
    await storage.delete(derivedKeys.dir(doc.id));
  }
  return documents.length;
}
