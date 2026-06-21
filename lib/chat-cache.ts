import * as SQLite from "expo-sqlite";
import type { ChatMessage } from "@/types/chat";

// On-device SQLite cache of a thesis's chat so it appears instantly on open and
// is readable offline. The server stays the source of truth — `lastSyncedAt` is
// the createdAt of the newest message confirmed from the server, used to fetch
// only the delta on the next sync (GET /api/chat/:id?since=...).
//
// SQLite (not AsyncStorage) so large conversations — generated chapters, long
// histories — aren't capped by the key-value store's size limit, and per-thesis
// reads stay fast via an index.
export interface ChatCache {
  messages: ChatMessage[];
  lastSyncedAt: string | null;
}

interface MessageRow {
  id: string;
  thesis_id: string;
  role: string;
  content: string;
  chapter_id: string | null;
  section_id: string | null;
  pending: number;
  created_at: string;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("modakerati.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY NOT NULL,
          thesis_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          chapter_id TEXT,
          section_id TEXT,
          pending INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_thesis_created
          ON chat_messages (thesis_id, created_at);
        CREATE TABLE IF NOT EXISTS chat_sync (
          thesis_id TEXT PRIMARY KEY NOT NULL,
          last_synced_at TEXT
        );
      `);
      return db;
    })();
  }
  return dbPromise;
}

export async function getCache(thesisId: string): Promise<ChatCache | null> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM chat_messages WHERE thesis_id = ? ORDER BY created_at ASC`,
      [thesisId]
    );
    const sync = await db.getFirstAsync<{ last_synced_at: string | null }>(
      `SELECT last_synced_at FROM chat_sync WHERE thesis_id = ?`,
      [thesisId]
    );
    if (rows.length === 0 && !sync) return null;

    const messages: ChatMessage[] = rows.map((r) => ({
      id: r.id,
      thesisId: r.thesis_id,
      role: r.role as ChatMessage["role"],
      content: r.content,
      chapterId: r.chapter_id ?? undefined,
      sectionId: r.section_id ?? undefined,
      pending: r.pending === 1 ? true : undefined,
      createdAt: r.created_at,
    }));
    return { messages, lastSyncedAt: sync?.last_synced_at ?? null };
  } catch {
    return null;
  }
}

export async function setCache(thesisId: string, cache: ChatCache): Promise<void> {
  try {
    const db = await getDb();
    // Mirror the in-memory snapshot: replace this thesis's rows in one transaction.
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM chat_messages WHERE thesis_id = ?`, [thesisId]);
      for (const m of cache.messages) {
        await db.runAsync(
          `INSERT INTO chat_messages
             (id, thesis_id, role, content, chapter_id, section_id, pending, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            thesisId,
            m.role,
            m.content,
            m.chapterId ?? null,
            m.sectionId ?? null,
            m.pending ? 1 : 0,
            m.createdAt,
          ]
        );
      }
      await db.runAsync(
        `INSERT INTO chat_sync (thesis_id, last_synced_at) VALUES (?, ?)
         ON CONFLICT(thesis_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
        [thesisId, cache.lastSyncedAt ?? null]
      );
    });
  } catch {
    // Cache is best-effort; failing to persist must never break the chat.
  }
}

export async function clearCache(thesisId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM chat_messages WHERE thesis_id = ?`, [thesisId]);
      await db.runAsync(`DELETE FROM chat_sync WHERE thesis_id = ?`, [thesisId]);
    });
  } catch {
    // ignore
  }
}
