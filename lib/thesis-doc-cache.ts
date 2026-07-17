import * as SQLite from "expo-sqlite";
import type { DocumentDTO } from "@/lib/api";

// On-device SQLite cache of a thesis's live-.docx block model (the DocumentDTO
// from GET /api/thesis/:id/document). Lets the workspace paint the document
// instantly on open — from the last-known blocks — while the network copy is
// revalidated in the background. The server stays the source of truth; this is a
// best-effort cache and every failure is swallowed so it can never break editing.
//
// SQLite (not AsyncStorage) so a large document — hundreds of blocks, inline
// figure data URIs — isn't capped by the key-value store's size limit. We reuse
// the same `modakerati.db` file the chat cache opens (a second connection is fine
// under WAL) and keep one row per thesis.

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("modakerati.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS thesis_doc (
          thesis_id TEXT PRIMARY KEY NOT NULL,
          doc TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

// Read the cached document for a thesis, or null if nothing is cached / the row
// is unreadable. Only `available:true` docs are cached, so a hit is always a
// renderable block model.
export async function getDocCache(thesisId: string): Promise<DocumentDTO | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ doc: string }>(
      `SELECT doc FROM thesis_doc WHERE thesis_id = ?`,
      [thesisId],
    );
    if (!row?.doc) return null;
    return JSON.parse(row.doc) as DocumentDTO;
  } catch {
    return null;
  }
}

// Persist the latest document for a thesis (fire-and-forget). We only cache the
// live block model; `available:false` docs are skipped and any prior row cleared
// so we never resurrect a stale live doc for a thesis that lost its .docx.
export async function setDocCache(thesisId: string, doc: DocumentDTO): Promise<void> {
  try {
    const db = await getDb();
    if (!doc.available) {
      await db.runAsync(`DELETE FROM thesis_doc WHERE thesis_id = ?`, [thesisId]);
      return;
    }
    await db.runAsync(
      `INSERT INTO thesis_doc (thesis_id, doc, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(thesis_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
      [thesisId, JSON.stringify(doc), new Date().toISOString()],
    );
  } catch {
    // Cache is best-effort; failing to persist must never break the workspace.
  }
}

export async function clearDocCache(thesisId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM thesis_doc WHERE thesis_id = ?`, [thesisId]);
  } catch {
    // ignore
  }
}
