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
  failed: number;
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
          failed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_thesis_created
          ON chat_messages (thesis_id, created_at);
        CREATE TABLE IF NOT EXISTS chat_sync (
          thesis_id TEXT PRIMARY KEY NOT NULL,
          last_synced_at TEXT
        );
      `);
      // Additive column for installs created before it existed. SQLite has no
      // ADD COLUMN IF NOT EXISTS, and re-adding throws — so swallow that one
      // error rather than version-gating a single boolean.
      await db.execAsync(`ALTER TABLE chat_messages ADD COLUMN failed INTEGER NOT NULL DEFAULT 0;`)
        .catch(() => {});
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
    failed: r.failed === 1 ? true : undefined,
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
             (id, thesis_id, role, content, chapter_id, section_id, pending, failed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            thesisId,
            m.role,
            m.content,
            m.chapterId ?? null,
            m.sectionId ?? null,
            m.pending ? 1 : 0,
            m.failed ? 1 : 0,
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

/**
 * Drop optimistic rows older than `maxAgeMs` — a send that never landed.
 *
 * `deletePending` only runs after a SUCCESSFUL sync, so a message sent while
 * offline stayed in SQLite forever: it reloaded on every app open, looking to
 * the student like the message had been sent. They re-sent it, got another
 * un-reaped row, and the same question stacked up — which is what "the same
 * message repeats forever" actually was. (Confirmed against the server: the
 * database held ONE copy while the app rendered three.)
 *
 * A pending row that survived a restart is BY DEFINITION a send that failed:
 * the turn is long over. Reaping by age needs no network and no server round
 * trip, so it works in exactly the offline case that creates the problem.
 */
export async function deleteStalePending(thesisId: string, maxAgeMs: number): Promise<number> {
  try {
    const db = await getDb();
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const res = await db.runAsync(
      `DELETE FROM chat_messages WHERE thesis_id = ? AND pending = 1 AND created_at < ?`,
      [thesisId, cutoff]
    );
    return res.changes ?? 0;
  } catch {
    return 0;
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
