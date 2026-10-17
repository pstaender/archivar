import type { Database } from "bun:sqlite";
import type { Passkey } from "../../shared/auth";

/** Sessions end after this long without a request. */
export const SESSION_IDLE_DAYS = 30;

interface PasskeyRow {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface StoredPasskey {
  id: number;
  userId: number;
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

interface CredentialRow {
  id: number;
  user_id: number;
  credential_id: string;
  public_key: Uint8Array;
  counter: number;
  transports: string;
}

const CREDENTIAL_QUERY = "SELECT id, user_id, credential_id, public_key, counter, transports FROM passkeys";

const toCredential = (row: CredentialRow): StoredPasskey => ({
  id: row.id,
  userId: row.user_id,
  credentialId: row.credential_id,
  publicKey: new Uint8Array(row.public_key),
  counter: row.counter,
  transports: JSON.parse(row.transports) as string[],
});

const toPasskey = (row: PasskeyRow): Passkey => ({ id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at });

function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}

/** Login sessions (only a hash of each cookie value is stored) and passkeys. */
export class AuthRepository {
  constructor(private db: Database) {}

  createSession(userId: number): string {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    this.db.query("INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)").run(hashToken(token), userId);
    return token;
  }

  /** The user the session belongs to, or null when it is unknown or has expired; keeps it alive. */
  sessionUser(token: string): number | null {
    const row = this.db
      .query(`UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE token_hash = ? AND last_seen_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${SESSION_IDLE_DAYS} days') RETURNING user_id`)
      .get(hashToken(token)) as { user_id: number } | null;
    return row?.user_id ?? null;
  }

  deleteSession(token: string): void {
    this.db.query("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }

  deleteSessions(userId: number): void {
    this.db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }

  passkeys(userId: number): Passkey[] {
    const rows = this.db.query("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY id").all(userId) as PasskeyRow[];
    return rows.map(toPasskey);
  }

  anyPasskey(): boolean {
    return this.db.query("SELECT 1 FROM passkeys LIMIT 1").get() !== null;
  }

  /** Credentials for WebAuthn, of one user or of all. */
  credentials(userId?: number): StoredPasskey[] {
    const rows = (
      userId === undefined ? this.db.query(`${CREDENTIAL_QUERY}`).all() : this.db.query(`${CREDENTIAL_QUERY} WHERE user_id = ?`).all(userId)
    ) as CredentialRow[];
    return rows.map(toCredential);
  }

  credential(credentialId: string): StoredPasskey | null {
    const row = this.db.query(`${CREDENTIAL_QUERY} WHERE credential_id = ?`).get(credentialId) as CredentialRow | null;
    return row ? toCredential(row) : null;
  }

  addPasskey(userId: number, passkey: { credentialId: string; publicKey: Uint8Array; counter: number; transports: string[]; name: string }): Passkey {
    const row = this.db
      .query(`INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, name) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING id, name, created_at, last_used_at`)
      .get(userId, passkey.credentialId, passkey.publicKey, passkey.counter, JSON.stringify(passkey.transports), passkey.name) as PasskeyRow;
    return toPasskey(row);
  }

  usedPasskey(id: number, counter: number): void {
    this.db.query("UPDATE passkeys SET counter = ?, last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(counter, id);
  }

  deletePasskey(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM passkeys WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }

  deletePasskeys(userId: number): void {
    this.db.query("DELETE FROM passkeys WHERE user_id = ?").run(userId);
  }
}
