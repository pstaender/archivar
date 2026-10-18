import type { Database } from "bun:sqlite";
import { createI18n } from "../../shared/i18n";
import { DEFAULT_IMPORT_PRESET, describePreset, type ImagePreset, normalizePresetSteps, type PresetSteps } from "../../shared/presets";

interface PresetRow {
  id: number;
  name: string;
  steps: string;
  created_at: string;
}

const toPreset = (row: PresetRow): ImagePreset => ({
  id: row.id,
  name: row.name,
  steps: normalizePresetSteps(JSON.parse(row.steps)),
  createdAt: row.created_at,
});

export class PresetRepository {
  constructor(private db: Database) {}

  list(userId: number): ImagePreset[] {
    const rows = this.db
      .query("SELECT id, name, steps, created_at FROM image_presets WHERE user_id = ? ORDER BY name COLLATE NOCASE, id")
      .all(userId) as PresetRow[];
    return rows.map(toPreset);
  }

  get(userId: number, id: number): ImagePreset | null {
    const row = this.db.query("SELECT id, name, steps, created_at FROM image_presets WHERE user_id = ? AND id = ?").get(userId, id) as PresetRow | null;
    return row ? toPreset(row) : null;
  }

  create(userId: number, name: string, steps: PresetSteps): ImagePreset {
    const { id } = this.db
      .query("INSERT INTO image_presets (user_id, name, steps) VALUES (?, ?, ?) RETURNING id")
      .get(userId, name, JSON.stringify(steps)) as { id: number };
    return this.get(userId, id)!;
  }

  update(userId: number, id: number, fields: { name?: string; steps?: PresetSteps }): ImagePreset | null {
    if (fields.name !== undefined) this.db.query("UPDATE image_presets SET name = ? WHERE user_id = ? AND id = ?").run(fields.name, userId, id);
    if (fields.steps !== undefined) {
      this.db.query("UPDATE image_presets SET steps = ? WHERE user_id = ? AND id = ?").run(JSON.stringify(fields.steps), userId, id);
    }
    return this.get(userId, id);
  }

  delete(userId: number, id: number): boolean {
    return this.db.query("DELETE FROM image_presets WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
  }
}

/**
 * Image preparation on import used to be a fixed choice tied to OCR (`uploadEnhancement`, `autoDewarp`). It is now an
 * import preset, so every user gets the default one once, and older settings become a preset with the same effect.
 */
function legacyImportSteps(stored: Record<string, unknown>): PresetSteps | null {
  if (stored.autoOcr === false) return null;
  const steps: PresetSteps = {};
  switch (stored.uploadEnhancement ?? "bw") {
    case "bw":
      Object.assign(steps, DEFAULT_IMPORT_PRESET.steps);
      break;
    case "grayscale":
      Object.assign(steps, { autoRotate: true, colorMode: "grayscale", autoLevels: true });
      break;
    case "color":
      steps.autoRotate = true;
      break;
  }
  if (stored.autoDewarp === true) steps.autoDewarp = true;
  return Object.keys(steps).length ? steps : null;
}

export function seedImportPresets(db: Database): void {
  const users = db.query("SELECT id, settings FROM users WHERE import_preset_seeded = 0").all() as { id: number; settings: string }[];
  if (users.length === 0) return;
  const presets = new PresetRepository(db);
  db.transaction(() => {
    for (const user of users) {
      const stored = JSON.parse(user.settings) as Record<string, unknown>;
      const fresh = Object.keys(stored).length === 0;
      const defaultPreset = presets.create(user.id, DEFAULT_IMPORT_PRESET.name, DEFAULT_IMPORT_PRESET.steps);
      const legacy = fresh ? DEFAULT_IMPORT_PRESET.steps : legacyImportSteps(stored);
      let importPresetId: number | null = null;
      if (legacy && JSON.stringify(normalizePresetSteps(legacy)) === JSON.stringify(defaultPreset.steps)) importPresetId = defaultPreset.id;
      else if (legacy) importPresetId = presets.create(user.id, describePreset(createI18n({ lng: "de" }).t, legacy), normalizePresetSteps(legacy)).id;
      const { uploadEnhancement: _, autoDewarp: __, ...kept } = stored;
      db.query("UPDATE users SET settings = ?, import_preset_seeded = 1 WHERE id = ?").run(JSON.stringify({ ...kept, importPresetId }), user.id);
    }
  })();
}
