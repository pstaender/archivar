import { Database } from "bun:sqlite";

export const DEFAULT_USER_NAME = "default";

const migrations: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE stacks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    page_count INTEGER,
    stack_id INTEGER REFERENCES stacks(id) ON DELETE SET NULL,
    stack_position INTEGER NOT NULL DEFAULT 0,
    edit_settings TEXT NOT NULL DEFAULT '{}',
    ocr_text TEXT NOT NULL DEFAULT '',
    ocr_status TEXT NOT NULL DEFAULT 'none',
    ocr_confidence REAL,
    ocr_error TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX documents_user ON documents(user_id, updated_at);
  CREATE INDEX documents_stack ON documents(stack_id, stack_position);

  CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    UNIQUE (user_id, path)
  );

  CREATE TABLE document_folders (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, folder_id)
  );

  CREATE TABLE stack_folders (
    stack_id INTEGER NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    PRIMARY KEY (stack_id, folder_id)
  );
  `,
  `ALTER TABLE documents ADD COLUMN ocr_removed INTEGER NOT NULL DEFAULT 0;`,
  `ALTER TABLE documents ADD COLUMN ocr_layout TEXT;`,
  `ALTER TABLE users ADD COLUMN settings TEXT NOT NULL DEFAULT '{}';`,
  `
  ALTER TABLE documents ADD COLUMN ocr_language TEXT;
  ALTER TABLE documents ADD COLUMN ocr_languages TEXT;
  `,
  `ALTER TABLE documents ADD COLUMN ocr_all_text INTEGER NOT NULL DEFAULT 0;`,
  `
  CREATE TABLE folder_order (
    folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (folder_id, item_type, item_id)
  );
  `,
  `
  CREATE TABLE image_presets (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX image_presets_user ON image_presets(user_id);
  `,
];

export function migrate(db: Database): void {
  const { user_version: current } = db.query("PRAGMA user_version").get() as { user_version: number };
  for (let version = current; version < migrations.length; version++) {
    db.transaction(() => {
      db.exec(migrations[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
}

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  db.query("INSERT OR IGNORE INTO users (name) VALUES (?)").run(DEFAULT_USER_NAME);
  return db;
}
