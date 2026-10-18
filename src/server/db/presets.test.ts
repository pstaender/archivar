import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { migrate } from "./database";
import { PresetRepository, seedImportPresets } from "./presets";

function databaseWithUsers(settings: Record<string, unknown>[]) {
  const db = new Database(":memory:", { strict: true });
  migrate(db);
  settings.forEach((value, i) => db.query("INSERT INTO users (name, settings) VALUES (?, ?)").run(`user${i}`, JSON.stringify(value)));
  return db;
}

const stored = (db: Database, id: number) => JSON.parse((db.query("SELECT settings FROM users WHERE id = ?").get(id) as { settings: string }).settings);

describe("import preset seeding", () => {
  test("turns the old image preparation on import into an import preset, once", () => {
    const db = databaseWithUsers([
      {},
      { uploadEnhancement: "grayscale", autoDewarp: true, ocrAllText: true },
      { autoOcr: false },
      { uploadEnhancement: "original" },
    ]);
    seedImportPresets(db);
    seedImportPresets(db);
    const presets = new PresetRepository(db);

    const [fresh] = presets.list(1);
    expect(presets.list(1)).toHaveLength(1);
    expect(fresh).toMatchObject({ name: "OCR optimized", steps: { autoRotate: true, autoBw: true, autoLevels: true } });
    expect(stored(db, 1)).toEqual({ importPresetId: fresh!.id });

    const gray = presets.list(2).find((p) => p.id === stored(db, 2).importPresetId);
    expect(gray).toMatchObject({ name: "Rotate automatically, Dewarp automatically, Grayscale, Auto levels" });
    expect(stored(db, 2)).toEqual({ ocrAllText: true, importPresetId: gray!.id });

    expect(presets.list(3)).toHaveLength(1);
    expect(stored(db, 3)).toEqual({ autoOcr: false, importPresetId: null });
    expect(stored(db, 4).importPresetId).toBeNull();
  });
});
