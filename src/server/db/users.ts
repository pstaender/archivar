import type { Database } from "bun:sqlite";
import { normalizeUserSettings, type UserSettings } from "../../shared/settings";
import type { User } from "../../shared/types";

export class UserRepository {
  constructor(private db: Database) {}

  findByName(name: string): User | null {
    return (this.db.query("SELECT id, name FROM users WHERE name = ?").get(name) as User | null) ?? null;
  }

  find(id: number): User | null {
    return (this.db.query("SELECT id, name FROM users WHERE id = ?").get(id) as User | null) ?? null;
  }

  list(): User[] {
    return this.db.query("SELECT id, name FROM users ORDER BY id").all() as User[];
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
