import * as SQLite from "expo-sqlite";
import type { ChatMessage } from "@/types/chat";

// On-device SQLite cache of a thesis's chat so it appears instantly on open and
// is readable offline. The server stays the source of truth — `lastSyncedAt` is
// the createdAt of the newest message confirmed from the server, used to fetch
// only the delta on the next sync (GET /api/chat/:id?since=...).
//
// Messages are UPSERTED (by id), never replace-all: infinite scroll pages older
// history into this table over time, and a windowed in-memory view must never
// cause the older cached rows to be deleted. Reads are paginated (latest page /
// older-than-cursor page) to mirror the server's infinite-scroll contract.
//
// SQLite (not AsyncStorage) so large conversations — generated chapters, long
// histories — aren't capped by the key-value store's size limit, and per-thesis
// reads stay fast via an index.

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

function rowToMessage(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    thesisId: r.thesis_id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    chapterId: r.chapter_id ?? undefined,
    sectionId: r.section_id ?? undefined,
    pending: r.pending === 1 ? true : undefined,
    createdAt: r.created_at,
  };
}

// A paginated read result: the page in chronological (oldest→newest) order, plus
// whether the cache holds still-older messages beyond it.
export interface CachePage {
  messages: ChatMessage[];
  hasMore: boolean;
}

// The newest `limit` messages for a thesis (chronological). `hasMore` is true when
// older messages exist in the cache beyond this page — detected by over-fetching
// one row.
export async function getLatestMessages(thesisId: string, limit: number): Promise<CachePage> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM chat_messages WHERE thesis_id = ? ORDER BY created_at DESC LIMIT ?`,
      [thesisId, limit + 1]
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse(); // DESC → chronological
    return { messages: page.map(rowToMessage), hasMore };
  } catch {
    return { messages: [], hasMore: false };
  }
}

// The newest `limit` messages OLDER than the `before` ISO cursor (chronological).
// Used to reveal earlier history on scroll-to-top (offline / cache-warm path).
export async function getOlderMessages(thesisId: string, before: string, limit: number): Promise<CachePage> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM chat_messages WHERE thesis_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
      [thesisId, before, limit + 1]
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page.map(rowToMessage), hasMore };
  } catch {
    return { messages: [], hasMore: false };
  }
}

// Insert-or-replace messages by id in one transaction. Additive — leaves rows
// outside this set (older pages, other theses) untouched. Best-effort.
export async function upsertMessages(thesisId: string, messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const m of messages) {
        await db.runAsync(
          `INSERT OR REPLACE INTO chat_messages
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
    });
  } catch {
    // Cache is best-effort; failing to persist must never break the chat.
  }
}

// Drop optimistic (client-id, not-yet-server-confirmed) rows. Called when a sync
// brings the authoritative server copies, so the local-id placeholders don't
// linger as duplicates alongside their server-id versions.
export async function deletePending(thesisId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM chat_messages WHERE thesis_id = ? AND pending = 1`, [thesisId]);
  } catch {
    // ignore
  }
}

export async function getLastSyncedAt(thesisId: string): Promise<string | null> {
  try {
    const db = await getDb();
    const sync = await db.getFirstAsync<{ last_synced_at: string | null }>(
      `SELECT last_synced_at FROM chat_sync WHERE thesis_id = ?`,
      [thesisId]
    );
    return sync?.last_synced_at ?? null;
  } catch {
    return null;
  }
}

export async function setLastSyncedAt(thesisId: string, lastSyncedAt: string | null): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO chat_sync (thesis_id, last_synced_at) VALUES (?, ?)
       ON CONFLICT(thesis_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
      [thesisId, lastSyncedAt ?? null]
    );
  } catch {
    // ignore
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
