import type { Database } from "bun:sqlite";
import { type ImagePreset, normalizePresetSteps, type PresetSteps } from "../../shared/presets";

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
