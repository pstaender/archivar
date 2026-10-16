import type { Database } from "bun:sqlite";
import type { User } from "../../shared/types";

export class UserRepository {
  constructor(private db: Database) {}

  findByName(name: string): User | null {
    return (this.db.query("SELECT id, name FROM users WHERE name = ?").get(name) as User | null) ?? null;
  }

  find(id: number): User | null {
    return (this.db.query("SELECT id, name FROM users WHERE id = ?").get(id) as User | null) ?? null;
  }
}
