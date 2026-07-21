import * as SQLite from "expo-sqlite";
import type { OutlineDTO } from "@/lib/api";

// On-device SQLite cache of a thesis's structural outline (the OutlineDTO from
// GET /api/thesis/:id/outline). Lets the Thesis Structure sheet paint the heading
// tree INSTANTLY on open — from the last-known outline — while the network copy is
// revalidated in the background (stale-while-revalidate). The server stays the
// source of truth; this is best-effort and every failure is swallowed so it can
// never break the sheet.
//
// We reuse the same `modakerati.db` file the chat / doc caches open (a second
// connection is fine under WAL) and keep one row per thesis.

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("modakerati.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS thesis_outline (
          thesis_id TEXT PRIMARY KEY NOT NULL,
          data TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

// Read the cached outline for a thesis, or null if nothing is cached / the row is
// unreadable. Only `available:true` outlines are cached, so a hit always has a
// renderable heading tree.
export async function getCachedOutline(thesisId: string): Promise<OutlineDTO | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ data: string }>(
      `SELECT data FROM thesis_outline WHERE thesis_id = ?`,
      [thesisId],
    );
    if (!row?.data) return null;
    return JSON.parse(row.data) as OutlineDTO;
  } catch {
    return null;
  }
}

// Persist the latest outline for a thesis (fire-and-forget). We only cache the
// available tree; an `available:false` outline is skipped and any prior row
// cleared so a thesis that lost its .docx never resurrects a stale structure.
export async function setCachedOutline(thesisId: string, outline: OutlineDTO): Promise<void> {
  try {
    const db = await getDb();
    if (!outline.available) {
      await db.runAsync(`DELETE FROM thesis_outline WHERE thesis_id = ?`, [thesisId]);
      return;
    }
    await db.runAsync(
      `INSERT INTO thesis_outline (thesis_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(thesis_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [thesisId, JSON.stringify(outline), new Date().toISOString()],
    );
  } catch {
    // Cache is best-effort; failing to persist must never break the sheet.
  }
}

export async function clearOutlineCache(thesisId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM thesis_outline WHERE thesis_id = ?`, [thesisId]);
  } catch {
    // ignore
  }
}
