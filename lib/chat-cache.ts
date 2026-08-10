import * as SQLite from "expo-sqlite";
import type { ChatMessage } from "@/types/chat";

// On-device SQLite cache of a thread's chat so it appears instantly on open and
// is readable offline. The server stays the source of truth — `lastSyncedAt` is
// the createdAt of the newest message confirmed from the server, used to fetch
// only the delta on the next sync (GET /api/threads/:id/messages?since=...).
//
// Messages are UPSERTED (by id), never replace-all: infinite scroll pages older
// history into this table over time, and a windowed in-memory view must never
// cause the older cached rows to be deleted. Reads are paginated (latest page /
// older-than-cursor page) to mirror the server's infinite-scroll contract.
//
// SQLite (not AsyncStorage) so large conversations — generated chapters, long
// histories — aren't capped by the key-value store's size limit, and per-thread
// reads stay fast via an index.

interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  chapter_id: string | null;
  section_id: string | null;
  pending: number;
  failed: number;
  created_at: string;
}

// Bumped whenever the on-device schema changes in a way old rows can't be
// migrated into (see the drop-and-rebuild below). Read out of `chat_cache_meta`
// on every open; a stored version below this triggers the one-time migration.
const CACHE_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("modakerati.db");
      await db.execAsync(`PRAGMA journal_mode = WAL;`);

      // Meta table must exist before we can read a version out of it. Safe to
      // run on every open — a fresh install just creates an empty table here.
      await db.execAsync(`CREATE TABLE IF NOT EXISTS chat_cache_meta (version INTEGER NOT NULL);`);
      const meta = await db.getFirstAsync<{ version: number }>(`SELECT version FROM chat_cache_meta LIMIT 1`);
      const storedVersion = meta?.version ?? 0;

      if (storedVersion < CACHE_VERSION) {
        // The cache keys off a thread now. Old rows are keyed by thesis and cannot be
        // mapped on-device — thread ids live on the server — so converting would mean
        // inventing ids that don't exist. Dropping is correct and costs one refetch of
        // the latest page, which first-open sync does anyway.
        //
        // On a fresh install these tables don't exist yet, so the drop is a no-op
        // (IF EXISTS) and this simply records the current version before the
        // CREATE TABLEs below run.
        await db.execAsync(`
          DROP TABLE IF EXISTS chat_messages;
          DROP TABLE IF EXISTS chat_sync;
        `);
        await db.execAsync(`DELETE FROM chat_cache_meta;`);
        await db.runAsync(`INSERT INTO chat_cache_meta (version) VALUES (?)`, [CACHE_VERSION]);
      }

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id TEXT PRIMARY KEY NOT NULL,
          thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          chapter_id TEXT,
          section_id TEXT,
          pending INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_thread_created
          ON chat_messages (thread_id, created_at);
        CREATE TABLE IF NOT EXISTS chat_sync (
          thread_id TEXT PRIMARY KEY NOT NULL,
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
    threadId: r.thread_id,
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

// The newest `limit` messages for a thread (chronological). `hasMore` is true when
// older messages exist in the cache beyond this page — detected by over-fetching
// one row.
export async function getLatestMessages(threadId: string, limit: number): Promise<CachePage> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`,
      [threadId, limit + 1]
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
export async function getOlderMessages(threadId: string, before: string, limit: number): Promise<CachePage> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync<MessageRow>(
      `SELECT * FROM chat_messages WHERE thread_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
      [threadId, before, limit + 1]
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return { messages: page.map(rowToMessage), hasMore };
  } catch {
    return { messages: [], hasMore: false };
  }
}

// Insert-or-replace messages by id in one transaction. Additive — leaves rows
// outside this set (older pages, other threads) untouched. Best-effort.
export async function upsertMessages(threadId: string, messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const m of messages) {
        await db.runAsync(
          `INSERT OR REPLACE INTO chat_messages
             (id, thread_id, role, content, chapter_id, section_id, pending, failed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            m.id,
            threadId,
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
export async function deletePending(threadId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(`DELETE FROM chat_messages WHERE thread_id = ? AND pending = 1`, [threadId]);
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
export async function deleteStalePending(threadId: string, maxAgeMs: number): Promise<number> {
  try {
    const db = await getDb();
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const res = await db.runAsync(
      `DELETE FROM chat_messages WHERE thread_id = ? AND pending = 1 AND created_at < ?`,
      [threadId, cutoff]
    );
    return res.changes ?? 0;
  } catch {
    return 0;
  }
}

export async function getLastSyncedAt(threadId: string): Promise<string | null> {
  try {
    const db = await getDb();
    const sync = await db.getFirstAsync<{ last_synced_at: string | null }>(
      `SELECT last_synced_at FROM chat_sync WHERE thread_id = ?`,
      [threadId]
    );
    return sync?.last_synced_at ?? null;
  } catch {
    return null;
  }
}

export async function setLastSyncedAt(threadId: string, lastSyncedAt: string | null): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO chat_sync (thread_id, last_synced_at) VALUES (?, ?)
       ON CONFLICT(thread_id) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
      [threadId, lastSyncedAt ?? null]
    );
  } catch {
    // ignore
  }
}

export async function clearCache(threadId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM chat_messages WHERE thread_id = ?`, [threadId]);
      await db.runAsync(`DELETE FROM chat_sync WHERE thread_id = ?`, [threadId]);
    });
  } catch {
    // ignore
  }
}
