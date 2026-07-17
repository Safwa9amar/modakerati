import * as SQLite from "expo-sqlite";
import type { ThesisOp } from "@/lib/thesis-ops";

// On-device durable queue of not-yet-confirmed thesis edit ops. Every optimistic
// edit is persisted here BEFORE its server call is attempted and deleted only
// after the server confirms — so edits survive an app kill, a crash, or a dead
// connection, and are replayed in order when the thesis is next opened (or the
// network returns). See stores/thesis-doc-store.ts for the flush machinery.
//
// Same SQLite file as the chat/doc caches (second connection under WAL is fine).
// All failures are swallowed: persistence is a reliability net — a broken disk
// queue must never break live editing (the in-memory chain still works).

export interface QueuedOp {
  id: string;
  thesisId: string;
  op: ThesisOp;
  createdAt: string;
  attempts: number;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("modakerati.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS thesis_ops (
          id TEXT PRIMARY KEY NOT NULL,
          thesis_id TEXT NOT NULL,
          op TEXT NOT NULL,
          created_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_thesis_ops_thesis
          ON thesis_ops (thesis_id, created_at);
      `);
      return db;
    })();
  }
  return dbPromise;
}

let seq = 0;
/** Sortable unique id: enqueue order == replay order even within one ms. */
export function newOpId(): string {
  return `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function enqueueOp(id: string, thesisId: string, op: ThesisOp): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO thesis_ops (id, thesis_id, op, created_at, attempts) VALUES (?, ?, ?, ?, 0)`,
      [id, thesisId, JSON.stringify(op), new Date().toISOString()],
    );
  } catch {
    // Best-effort: the op still runs via the in-memory chain this session.
  }
}

export async function confirmOp(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM thesis_ops WHERE id = ?`, [id]);
  } catch {
    // A leaked row is replayed on next open; the server applying an already-
    // applied formatting/text op is idempotent, structural ops are rare enough.
  }
}

export async function bumpOpAttempts(id: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`UPDATE thesis_ops SET attempts = attempts + 1 WHERE id = ?`, [id]);
  } catch {
    // ignore
  }
}

/** All queued ops for a thesis, oldest first (replay order). */
export async function listQueuedOps(thesisId: string): Promise<QueuedOp[]> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<{
      id: string;
      thesis_id: string;
      op: string;
      created_at: string;
      attempts: number;
    }>(`SELECT * FROM thesis_ops WHERE thesis_id = ? ORDER BY created_at ASC, id ASC`, [thesisId]);
    const out: QueuedOp[] = [];
    for (const r of rows) {
      try {
        out.push({ id: r.id, thesisId: r.thesis_id, op: JSON.parse(r.op) as ThesisOp, createdAt: r.created_at, attempts: r.attempts });
      } catch {
        // Unparseable row → drop it rather than wedge the queue forever.
        void confirmOp(r.id);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Drop every queued op for a thesis (a permanently-rejected op poisons the
 *  positional indices of everything queued after it). */
export async function clearQueuedOps(thesisId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM thesis_ops WHERE thesis_id = ?`, [thesisId]);
  } catch {
    // ignore
  }
}
