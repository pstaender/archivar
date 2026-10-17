import type { Database } from "bun:sqlite";
import { normalizeVectorAreas, type VectorArea } from "../../vectorizer";

/** The vectorized areas of a document and the geometry of the edited image they were made on. */
export interface VectorLayer {
  areas: VectorArea[];
  geometry: string;
}

export class VectorRepository {
  constructor(private db: Database) {}

  get(userId: number, documentId: number): VectorLayer | null {
    const row = this.db
      .query("SELECT v.areas, v.geometry FROM document_vectors v JOIN documents d ON d.id = v.document_id WHERE d.user_id = ? AND v.document_id = ?")
      .get(userId, documentId) as { areas: string; geometry: string } | null;
    return row ? { areas: normalizeVectorAreas(JSON.parse(row.areas)), geometry: row.geometry } : null;
  }

  /** Callers check that the document belongs to the user. An empty list removes the layer. */
  set(documentId: number, layer: VectorLayer): void {
    if (layer.areas.length === 0) {
      this.db.query("DELETE FROM document_vectors WHERE document_id = ?").run(documentId);
      return;
    }
    this.db
      .query(
        `INSERT INTO document_vectors (document_id, areas, area_count, geometry) VALUES (?, ?, ?, ?)
         ON CONFLICT(document_id) DO UPDATE SET areas = excluded.areas, area_count = excluded.area_count, geometry = excluded.geometry`,
      )
      .run(documentId, JSON.stringify(layer.areas), layer.areas.length, layer.geometry);
  }
}
