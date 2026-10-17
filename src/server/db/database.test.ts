import { expect, test } from "bun:test";
import { openDatabase, migrate } from "./database";

test("rebuilding the documents table keeps the rows that reference documents", () => {
  const db = openDatabase(":memory:");
  const { version } = db.query("SELECT user_version AS version FROM pragma_user_version").get() as { version: number };
  const insert = db.query("INSERT INTO documents (user_id, original_name, mime_type, kind, size, storage_key, copy_of) VALUES (1, 'a.jpg', 'image/jpeg', 'image', 1, 'k', ?) RETURNING id");
  const original = (insert.get(null) as { id: number }).id;
  const copy = (insert.get(original) as { id: number }).id;
  db.query("INSERT INTO folders (user_id, path) VALUES (1, 'wichtig')").run();
  db.query("INSERT INTO document_folders (document_id, folder_id) VALUES (?, 1)").run(copy);
  db.query("INSERT INTO document_vectors (document_id, areas, area_count, geometry) VALUES (?, '[]', 0, '')").run(copy);

  db.exec(`PRAGMA user_version = ${version - 1}`);
  migrate(db);

  expect(db.query("SELECT copy_of AS copyOf FROM documents WHERE id = ?").get(copy)).toEqual({ copyOf: original });
  expect(db.query("SELECT COUNT(*) AS n FROM document_folders").get()).toEqual({ n: 1 });
  expect(db.query("SELECT COUNT(*) AS n FROM document_vectors").get()).toEqual({ n: 1 });
  expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

  db.query("DELETE FROM documents WHERE id = ?").run(copy);
  expect((insert.get(null) as { id: number }).id).toBe(copy + 1);
});
