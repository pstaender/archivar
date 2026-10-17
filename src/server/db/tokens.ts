import type { Database } from "bun:sqlite";
import type { ApiToken, CreatedApiToken } from "../../shared/tokens";

interface TokenRow {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const toToken = (row: TokenRow): ApiToken => ({ id: row.id, name: row.name, prefix: row.prefix, createdAt: row.created_at, lastUsedAt: row.last_used_at });

const TOKEN_PREFIX = "arch_";

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** Only a hash of each token is stored. */
export class TokenRepository {
  constructor(private db: Database) {}

  list(userId: number): ApiToken[] {
    const rows = this.db
      .query("SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id")
      .all(userId) as TokenRow[];
    return rows.map(toToken);
  }

  create(userId: number, name: string): CreatedApiToken {
    const token = TOKEN_PREFIX + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const prefix = token.slice(0, TOKEN_PREFIX.length + 6);
    const row = this.db
      .query("INSERT INTO api_tokens (user_id, name, prefix, token_hash) VALUES (?, ?, ?, ?) RETURNING id, name, prefix, created_at, last_used_at")
      .get(userId, name, prefix, hashToken(token)) as TokenRow;
    return { ...toToken(row), token };
  }

  delete(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM api_tokens WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }

  /** The user the token belongs to, or null; also records when it was used. */
  authenticate(token: string): number | null {
    const row = this.db
      .query("UPDATE api_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE token_hash = ? RETURNING user_id")
      .get(hashToken(token)) as { user_id: number } | null;
    return row?.user_id ?? null;
  }
}
