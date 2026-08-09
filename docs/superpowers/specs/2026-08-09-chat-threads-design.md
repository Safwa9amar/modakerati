# Chat threads — a ChatGPT-style conversation system

**Date:** 2026-08-09
**Status:** Design approved, ready for planning
**Repos touched:** `~/modakerati` (Expo app), `~/modakerati-server` (Hono/Drizzle)

---

## 1. Problem

Modakerati's chat is one endless log welded to a thesis. `chat_messages` is
`id · thesis_id · role · content · created_at` and nothing else — there is no
concept of a conversation. The consequences the student actually feels:

- No "New chat". Every question ever asked about a thesis lives in one scroll.
- No titles, no history, no way back to "that thing I asked last week".
- No chat at all before a thesis exists.
- An unrelated question permanently pollutes the thread the AI reads for context.

The AI engine itself is not the problem. Streaming, reasoning traces, image
attachments, file cards, ask-user sheets, destructive-action approval, live doc
tools, undo, RTL markdown, TTS, BYOK and per-turn logging all work. What's
missing is the *shell* around them.

## 2. What we're building

Conversations become first-class objects owned by the student.

| Decision | Choice |
| --- | --- |
| Thread ownership | **User-owned; thesis attachment optional** |
| History UI | **Chat-local slide-in panel** (the ChatGPT one), not the app drawer |
| Grouping | **The thesis is the folder.** No folders table. |
| v1 features | New chat, auto-title, rename, delete, date grouping, search, pin, archive |
| Explicitly out of v1 | Message-edit branching, hand-made folders |
| Unattached chats | Plain assistant — no doc tools, no RAG. Attach a thesis to unlock. |
| Writer ✦ entry | Resume the most recent thread for that thesis; ＋ starts a fresh one |
| Rollout | Additive, with a compatibility shim for un-updated installs |

**Branching is out**, which is what keeps `chat_messages` a flat list rather than
a tree — roughly half the build, avoided.

**Folders are out** because a thesis in this app already carries its own sources,
norm profile and template. It *is* a ChatGPT Project in everything but name. If
the list still feels messy after living with it, folders can be added later as a
grouping override without invalidating anything here.

---

## 3. Data model

### 3.1 New table

```sql
CREATE TABLE chat_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  thesis_id       uuid REFERENCES theses(id) ON DELETE CASCADE,  -- NULL = unattached
  title           text,                                          -- NULL until auto-titled
  pinned          boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

There is deliberately **no `message_count`**. A positional count stops being true
the moment regenerate deletes rows — the lesson already paid for in
`chat_summaries`, where `last_message_at` had to replace exactly that. Ordering,
grouping and summary slicing all key off timestamps.

`thesis_id` cascades: deleting a thesis deletes its threads. That matches today's
behaviour (`chat_messages.thesis_id` already cascades) and keeps
`deleteThesisCompletely` honest — it gets extended to sweep threads and their
summaries.

### 3.2 Changes to `chat_messages`

```sql
ALTER TABLE chat_messages ADD COLUMN thread_id uuid REFERENCES chat_threads(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ALTER COLUMN thesis_id DROP NOT NULL;
ALTER TABLE chat_messages ADD COLUMN search_text text;
```

`thesis_id` survives as a **deprecated denormalized column**, kept only so the
compatibility shim and any straggler code path keep working. Nothing new reads
it. It gets dropped one release after the shim does.

`search_text` exists because `content` cannot be indexed directly — it carries
`[[MODK_IMG]]`, `[[MODK_FILE]]`, `[[MODK_CONFIRM]]` and `[[MODK_TOOL]]` frames,
and a GIN index over those is both useless and enormous. It is written at insert
time as `stripControlFrames(content)` passed through the same Arabic normalizer
document search already uses.

### 3.3 Indexes

```sql
CREATE INDEX idx_chat_messages_thread_created ON chat_messages (thread_id, created_at);
CREATE INDEX idx_chat_messages_search         ON chat_messages USING GIN (to_tsvector('simple', search_text));
CREATE INDEX idx_chat_threads_user_recent     ON chat_threads (user_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_chat_threads_thesis_recent   ON chat_threads (thesis_id, last_message_at DESC NULLS LAST);
```

`'simple'` rather than a language config: the corpus is trilingual (en/fr/ar) and
no single stemmer serves all three. Tokenization without stemming plus the Arabic
normalizer is the right trade for literal recall — a student searching their
chats wants "where did I ask about APA", not fuzzy semantic neighbours.

Thread titles match by plain `ILIKE`. Per-user thread counts are small enough
that a trigram index is premature.

### 3.4 `chat_summaries`

Moves from one-per-thesis to one-per-thread.

```sql
ALTER TABLE chat_summaries ADD COLUMN thread_id uuid REFERENCES chat_threads(id) ON DELETE CASCADE;
ALTER TABLE chat_summaries DROP CONSTRAINT chat_summaries_thesis_id_key;  -- the UNIQUE
CREATE UNIQUE INDEX chat_summaries_thread_id_key ON chat_summaries (thread_id);
ALTER TABLE chat_summaries ALTER COLUMN thesis_id DROP NOT NULL;
```

The `DROP CONSTRAINT` name above is Postgres's default for a column-level
`UNIQUE`; confirm it against the live database before running, since the table
was created by `ensureSchema` rather than by a Drizzle migration.

`thesis_id` is kept nullable for legacy rows. `scripts/rebuild-chat-summary.ts`
and `scripts/probe-chat-context.ts` are updated to key off threads.

### 3.5 Migration

⚠️ **`ensureSchema` is dead on prod** — `templates` hit Postgres's 1600-column
ceiling, so `ensureSchema` aborts on every boot and nothing inside it runs. None
of the DDL above may go there.

The path is:

1. `chat_threads` added to `src/db/schema.ts`; the `chat_summaries` changes to
   `src/db/norm-profiles.ts` — both are already in `drizzle.config.ts`'s schema list.
2. A **hand-written** `sql/2026-08-09-chat-threads.sql`, not `drizzle-kit`.
   This was tried and the output was unusable: drizzle's snapshot is years behind
   the live database, because `ai_turn_trace`, `ai_turn_outcome`,
   `ai_missing_tool_log` and `divider_templates` were all created by
   `ensureSchema`'s raw SQL rather than by migrations. `generate` therefore emits
   `CREATE TABLE` for four tables that already exist and `ADD COLUMN` for two
   columns that already exist, and fails on its first statement; `push` would try
   to reconcile the entire drift. The hand-written file touches chat threads
   only, is wrapped in a transaction, and guards every statement so a re-run is a
   no-op. Confirmed while doing this: `templates` has 16 live columns but sits at
   **attnum 1600/1600**, the hard ceiling — which is precisely why `ensureSchema`
   aborts, and why nothing may touch that table.
3. `scripts/backfill-chat-threads.ts`, following the existing `backfill-*.ts`
   convention.

**Backfill semantics.** For each distinct `thesis_id` present in `chat_messages`
where `thread_id IS NULL`:

- Create one `chat_threads` row: `user_id` from `theses.user_id`, `thesis_id`,
  `title` = the thesis title, `created_at` = `MIN(chat_messages.created_at)`,
  `last_message_at`/`updated_at` = `MAX(chat_messages.created_at)`.
- Point that thesis's messages at it.
- Move the thesis's `chat_summaries` row onto the new `thread_id`.

Idempotent by construction: it only ever considers rows where `thread_id IS NULL`,
and reuses the oldest existing thread for a thesis if one is already there.

---

## 4. Server

### 4.1 File split

`src/routes/chat.ts` is 1177 lines and already does two unrelated jobs. It splits:

- **`src/routes/chat.ts`** keeps turn execution — `/send`, `/stream`,
  `/confirm-action`, `/cancel-action`, `/models/list`, `/suggestions`.
- **`src/routes/chat-threads.ts`** (new) owns thread CRUD, history and search.

### 4.2 New endpoints — `/api/threads`

Every one of these is scoped by `user_id` from the auth context.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/threads?thesisId=&archived=&limit=&before=` | List threads. Pinned first, then `last_message_at DESC`. |
| `POST` | `/api/threads` `{ thesisId? }` | Create. Returns the thread. |
| `GET` | `/api/threads/:id/messages?since=&before=&limit=` | History. Same three modes as today's endpoint (delta / paginated / full). |
| `PATCH` | `/api/threads/:id` `{ title?, pinned?, archived?, thesisId? }` | Rename, pin, archive, attach a thesis. `archived` is a boolean on the wire and maps to `archived_at = now()` / `NULL`. `thesisId: null` detaches. |
| `DELETE` | `/api/threads/:id` | Delete thread + its messages + its summary. |
| `GET` | `/api/threads/search?q=&limit=` | Cross-thread search: title ILIKE ∪ `search_text` FTS, returning thread + best-matching snippet. |

Date grouping (Today / Last 7 days / Older) is computed **client-side** from
`last_message_at`, so it respects the device's timezone rather than the server's.

### 4.3 Turn endpoints

`/stream` and `/send` take `threadId`; `thesisId` is derived from the thread
rather than sent by the client. `prepareTurnContext` changes signature from
`{ thesisId }` to `{ threadId, thesisId: string | null }`.

When `thesisId` is null:

- RAG retrieval is skipped.
- The document context block is omitted from the prompt.
- The MCP bridge exposes the **core tool set minus the doc tools** — a filter over
  the existing on-demand catalogue, not a second registry.
- The system prompt states plainly that no thesis is attached and that the
  student can attach one, so the model says so instead of inventing a document.

Attaching mid-conversation (`PATCH { thesisId }`) makes doc tools live from the
next turn on. The system prompt notes the attachment moment so the model doesn't
claim to have edited a document it couldn't see earlier.

### 4.4 Auto-title

After the first assistant turn completes on a thread whose `title IS NULL`, a
cheap one-shot completion produces a ≤6-word title **in the conversation's own
language**. It runs on the suggestions model (Workers AI llama-4-scout, ~3s) —
and per that model's known quirk, the prompt names Arabic explicitly when the
conversation is Arabic.

Language is detected from the student's **first message**, not from
`theses.language` — that field is unreliable (imports default to `"fr"` even for
Arabic theses), and an unattached thread has no thesis to ask anyway.

The title is pushed to the client as a new `[[MODK_TITLE]]` control frame on the
open stream, so the panel updates live with no refetch. This follows the existing
frame protocol exactly: parsed in `postChatStream`, stripped from displayed
content by `stripControlFrames`.

Titling failure is non-fatal — the thread keeps `title = NULL` and the UI falls
back to the first user message, truncated.

### 4.5 Compatibility shim

Old installs only know `POST /api/chat/stream { thesisId }` and
`GET /api/chat/:thesisId`. Both stay, as thin resolvers:

> given `thesisId` and no `threadId`, use the most recent non-archived thread for
> that thesis, creating one if none exists.

`DELETE /api/chat/:thesisId` deletes that same resolved thread. The shim is
roughly thirty lines and lets every slice below deploy independently.

### 4.6 Two live bugs fixed on the way through

These are in the exact code being rewritten, so they get fixed rather than
carried forward:

1. **`GET`/`DELETE /api/chat/:thesisId` never check ownership.** `authMiddleware`
   proves *a* user, but the handlers query on `thesis_id` alone — so any
   authenticated user holding another student's thesis uuid can read or wipe
   their chat. The new `/api/threads/*` handlers all filter on `user_id`, and the
   shim inherits that check.
2. **`DELETE /api/chat/:thesisId` resets the wrong columns.** It writes
   `theses.chat_summary` / `chat_summary_count`, which are dead — the live
   summary lives in `chat_summaries`. Clearing a chat therefore leaves a stale
   summary that leaks the deleted conversation into the next one. The thread
   delete removes the `chat_summaries` row properly.

---

## 5. App

### 5.1 State

**New — `stores/chat-threads-store.ts`:** the thread list, `currentThreadId`, the
thesis filter, search query and results, and the CRUD actions. One purpose: what
conversations exist and which one is open.

**Changed — `stores/chat-store.ts`:** `messages` is re-keyed from `thesisId` to
`threadId`, along with `hasMoreOlder` and `loadingOlder`. Everything else — turn
ownership (`beginTurn`/`isTurnActive`/`endTurn`), unconditional Stop, the tool
trace, the reasoning clock — is untouched. That machinery is hard-won and has no
opinion about threads.

**Deliberately still thesis-keyed:** `docChanges`. The "Undo AI changes" chip
points at a document history checkpoint, which is a property of the *document*,
not the conversation. Two threads editing one thesis must share it.

`types/chat.ts`: `ChatMessage.thesisId` → `threadId`.

### 5.2 Components

- **`components/chat/ChatHistoryPanel.tsx`** (new) — the slide-in. Search box, ＋,
  pinned section, then a section per thesis (thesis title as the header) and a
  "No thesis" section. Row shows title, relative time, and a 📄 badge when
  attached. Long-press → rename / pin / archive / delete.
- **`app/(app)/chat.tsx`** — `ThesisChat` becomes `ChatThread({ threadId })`. The
  screen resolves "newest thread for the current thesis, or create one" on mount.
  Its 1004 lines get the panel extracted out rather than added to.
- **`components/ChatOverlayPanel.tsx`** — passes `threadId` through; the history
  panel renders inside the overlay identically. This is the reason the panel is
  chat-local rather than a route.

Local SQLite persistence (`persistCache` in `lib/ai-service.ts`) re-keys from
thesis to thread.

### 5.3 i18n

New keys in `locales/{en,fr,ar}.json`. ⚠️ Those files contain duplicate keys —
they must be edited **surgically**. A `json.load` / `json.dump` round-trip
silently drops keys.

---

## 6. Error handling and edge cases

| Situation | Behaviour |
| --- | --- |
| Thread created offline | Optimistic local uuid, reconciled on sync — the same `pending` pattern messages already use. |
| The open thread is deleted | Fall back to the newest remaining thread for that thesis, or a fresh empty one. |
| The open thread is archived | Stays open. Archive only hides it from the list. |
| Send in an unattached thread | Stays unattached. Attachment is always explicit — never silent. |
| Un-updated app hits `/api/chat/*` | Compatibility shim resolves a thread. Student notices nothing. |
| Auto-title fails | Thread keeps `title = NULL`; UI falls back to the truncated first user message. |
| Search returns a message in an archived thread | Shown, with an "Archived" marker on the row. |
| Thesis deleted while its thread is open | Cascade removes the thread; UI drops to a fresh unattached chat. |

## 7. Testing

**Server** (vitest, already present):

- Backfill script: idempotency (two runs, one thread), correct `created_at` /
  `last_message_at`, summary relocation.
- Thread CRUD: ownership enforcement — user B gets 404, not 200, on user A's thread.
- Compat shim: `thesisId`-only request resolves the newest thread; creates one
  when none exists.
- Search: control frames are excluded from `search_text`; Arabic normalization
  matches across forms.
- No-thesis turn: doc tools absent from the catalogue, RAG skipped.

**App** — there is no JS test runner. The gate is `npx tsc --noEmit` plus running
it, per the project's standing rule.

## 8. Build order

Each slice deploys on its own, behind the compat shim.

1. **Schema + backfill.** No behaviour change; the shim keeps `/api/chat/*` working.
2. **`/api/threads` endpoints** + the `chat.ts` file split. Still no UI.
3. **App re-key + history panel.** The feature becomes visible. In this slice ＋
   New chat always creates a thread **pre-attached to the current thesis** — the
   entry point is the Writer, and the no-thesis code path doesn't exist yet.
4. **Search, pin, archive.**
5. **Unattached mode** — no-thesis tool filter, plus the UI that can create a
   thread with no thesis and attach one later. Only here does `thesis_id = NULL`
   become reachable from the app.
6. **Cleanup**, one release later: drop the shim, drop `chat_messages.thesis_id`.

Auto-title lands with slice 3, since an untitled list is unusable.

Slices 1–4 never produce a thread with `thesis_id = NULL`, so the nullable column
is dormant until slice 5 — which is what makes the no-thesis branch safe to defer
without leaving broken states behind in the meantime.
