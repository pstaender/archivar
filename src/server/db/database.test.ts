import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, migrations, openDatabase } from "./database";

const versionBefore = (table: string) => migrations.findIndex((sql) => sql.includes(`CREATE TABLE ${table}_new`));

/** A database as it was before the migration that rebuilds `table`. */
function databaseBefore(table: string): Database {
  const db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, versionBefore(table));
  db.query("INSERT INTO users (name) VALUES ('default')").run();
  return db;
}

test("rebuilding the documents table keeps the rows that reference documents", () => {
  const db = databaseBefore("documents");
  const insert = db.query("INSERT INTO documents (user_id, original_name, mime_type, kind, size, storage_key, copy_of) VALUES (1, 'a.jpg', 'image/jpeg', 'image', 1, 'k', ?) RETURNING id");
  const original = (insert.get(null) as { id: number }).id;
  const copy = (insert.get(original) as { id: number }).id;
  db.query("INSERT INTO folders (user_id, path) VALUES (1, 'wichtig')").run();
  db.query("INSERT INTO document_folders (document_id, folder_id) VALUES (?, 1)").run(copy);
  db.query("INSERT INTO document_vectors (document_id, areas, area_count, geometry) VALUES (?, '[]', 0, '')").run(copy);

  migrate(db);

  expect(db.query("SELECT copy_of AS copyOf FROM documents WHERE id = ?").get(copy)).toEqual({ copyOf: original });
  expect(db.query("SELECT COUNT(*) AS n FROM document_folders").get()).toEqual({ n: 1 });
  expect(db.query("SELECT COUNT(*) AS n FROM document_vectors").get()).toEqual({ n: 1 });
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

  db.query("DELETE FROM documents WHERE id = ?").run(copy);
  expect((insert.get(null) as { id: number }).id).toBe(copy + 1);
});

test("rebuilding the stacks table keeps its documents and folders", () => {
  const db = databaseBefore("stacks");
  const insert = db.query("INSERT INTO stacks (user_id, title) VALUES (1, 'Steuer') RETURNING id");
  const stack = (insert.get() as { id: number }).id;
  db.query("INSERT INTO documents (user_id, original_name, mime_type, kind, size, storage_key, stack_id) VALUES (1, 'a.jpg', 'image/jpeg', 'image', 1, 'k', ?)").run(stack);
  db.query("INSERT INTO folders (user_id, path) VALUES (1, 'wichtig')").run();
  db.query("INSERT INTO stack_folders (stack_id, folder_id) VALUES (?, 1)").run(stack);

  migrate(db);

  expect(db.query("SELECT stack_id AS stackId FROM documents").get()).toEqual({ stackId: stack });
  expect(db.query("SELECT COUNT(*) AS n FROM stack_folders").get()).toEqual({ n: 1 });

  db.query("DELETE FROM stacks WHERE id = ?").run(stack);
  expect((insert.get() as { id: number }).id).toBe(stack + 1);
});

test("the first user is created as admin, an existing default user is renamed to admin", () => {
  expect(openDatabase(":memory:").query("SELECT name, is_admin AS admin FROM users").all()).toEqual([{ name: "admin", admin: 1 }]);

  const db = new Database(":memory:", { strict: true });
  migrate(db, migrations.findIndex((sql) => sql.includes("is_admin")));
  db.query("INSERT INTO users (name) VALUES ('default'), ('anna')").run();
  migrate(db);
  expect(db.query("SELECT name, is_admin AS admin FROM users ORDER BY id").all()).toEqual([
    { name: "admin", admin: 1 },
    { name: "anna", admin: 0 },
  ]);
});
