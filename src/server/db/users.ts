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
