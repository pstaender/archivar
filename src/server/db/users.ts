import type { Database } from "bun:sqlite";
import { normalizeUserSettings, type UserSettings } from "../../shared/settings";
import type { User } from "../../shared/types";

interface UserRow {
  id: number;
  name: string;
  is_admin: number;
}

const toUser = (row: UserRow): User => ({ id: row.id, name: row.name, admin: row.is_admin === 1 });

export class UserRepository {
  constructor(private db: Database) {}

  findByName(name: string): User | null {
    const row = this.db.query("SELECT id, name, is_admin FROM users WHERE name = ?").get(name) as UserRow | null;
    return row && toUser(row);
  }

  find(id: number): User | null {
    const row = this.db.query("SELECT id, name, is_admin FROM users WHERE id = ?").get(id) as UserRow | null;
    return row && toUser(row);
  }

  list(): User[] {
    return (this.db.query("SELECT id, name, is_admin FROM users ORDER BY id").all() as UserRow[]).map(toUser);
  }

  create(name: string, passwordHash: string, admin: boolean): User {
    const row = this.db
      .query("INSERT INTO users (name, password_hash, is_admin) VALUES (?, ?, ?) RETURNING id, name, is_admin")
      .get(name, passwordHash, admin ? 1 : 0) as UserRow;
    return toUser(row);
  }

  /** Its rows in the other tables go with it (ON DELETE CASCADE); stored files are left to the caller. */
  delete(id: number): boolean {
    return this.db.query("DELETE FROM users WHERE id = ?").run(id).changes > 0;
  }

  count(): number {
    return (this.db.query("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  }

  passwordHash(id: number): string | null {
    return (this.db.query("SELECT password_hash FROM users WHERE id = ?").get(id) as { password_hash: string | null } | null)?.password_hash ?? null;
  }

  anyPassword(): boolean {
    return this.db.query("SELECT 1 FROM users WHERE password_hash IS NOT NULL LIMIT 1").get() !== null;
  }

  setPasswordHash(id: number, hash: string | null): void {
    this.db.query("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  }

  settings(id: number): UserSettings {
    const row = this.db.query("SELECT settings FROM users WHERE id = ?").get(id) as { settings: string } | null;
    return normalizeUserSettings(row ? JSON.parse(row.settings) : {});
  }

  updateSettings(id: number, update: unknown): UserSettings {
    const settings = normalizeUserSettings(update, this.settings(id));
    this.db.query("UPDATE users SET settings = ? WHERE id = ?").run(JSON.stringify(settings), id);
    return settings;
  }
}
