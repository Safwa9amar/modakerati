# Chat Threads — App + Auto-Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversations visible to the student — a chat-local history panel with search, pin and archive, backed by auto-generated titles — by re-keying the app from `thesisId` to `threadId`.

**Architecture:** The server foundation is already live (plan 1). This plan adds one server capability (auto-titling, pushed to the client as a new `[[MODK_TITLE]]` control frame on the open stream) and then moves the app across: the SQLite cache, the API client, the chat store, `ai-service`, and the chat screen all stop keying on `thesisId` and key on `threadId`. A new `chat-threads-store` owns the thread list; a new `ChatHistoryPanel` renders it inside both the chat screen and the Writer overlay.

**Tech Stack:** Expo (React Native, expo-sqlite, Zustand, i18next), Hono/Drizzle server, vitest (server only).

---

## Scope

This is **plan 2 of 4**, covering slices 3–4 of [the design spec](../specs/2026-08-09-chat-threads-design.md). Plan 3 is unattached mode; plan 4 drops the compatibility shim.

**Prerequisite that must land in this plan (spec §7b):** `pending_tool_actions` and `ai_tool_log` are keyed by `thesis_id` alone. That is dormant while each thesis has one thread — but this plan is what lets the app create a second, at which point a confirmation reply can stream into the wrong conversation. **Task 2 fixes it.** Do not ship the history panel without it.

## Verification, and why it differs from plan 1

The Expo app has **no JS test runner**. That is a standing project decision, not an oversight. So:

- **Server tasks** keep full TDD with vitest. Baseline: `npm test` → 960 passed / 84 files.
- **App tasks** are gated by `npx tsc --noEmit` (must be clean) plus **actually running the app** and exercising the described flow. Every app task below ends with a concrete "run it and check this" step. A task is not done because it compiles.

Do not add a test runner to the app as part of this work.

## Conventions

- Server work: `~/modakerati-server`, branch `feat/chat-threads`.
- App work: `~/modakerati`. **Branch first** — it is currently on `master`.
- Every commit message ends with a blank line then:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- `git add` exact paths, never `-A`.
- ⚠️ `locales/{en,fr,ar}.json` contain **duplicate keys**. Edit them surgically with Edit; a `json.load`/`json.dump` round-trip silently drops keys.

## File structure

| File | Responsibility |
| --- | --- |
| `~/modakerati-server/src/lib/ai/thread-title.ts` **(new)** | Pure: build the titling prompt, sanitize the model's answer. Unit-tested. |
| `~/modakerati-server/src/routes/chat.ts` **(modify)** | Fire the titler after the first assistant turn; emit `[[MODK_TITLE]]`. |
| `~/modakerati-server/src/routes/chat-threads.ts` **(modify)** | Add `POST /for-thesis` — the Writer's entry resolution. |
| `~/modakerati-server/src/db/schema.ts` + `sql/` **(modify)** | `pending_tool_actions.thread_id`. |
| `lib/chat-cache.ts` **(modify)** | Re-key the device cache to `thread_id`. |
| `lib/api.ts` **(modify)** | Thread CRUD/search client; chat calls carry `threadId`. |
| `stores/chat-threads-store.ts` **(new)** | The thread list, current thread, search results. |
| `types/chat.ts`, `stores/chat-store.ts` **(modify)** | `thesisId` → `threadId`. |
| `lib/ai-service.ts` **(modify)** | Every entry point takes `threadId`. |
| `lib/thread-groups.ts` **(new)** | Pure: group threads into Pinned / thesis sections. Small and obvious. |
| `components/chat/ChatHistoryPanel.tsx` **(new)** | The slide-in list: search, ＋, pinned, per-thesis sections. |
| `app/(app)/chat.tsx` **(modify)** | `ThesisChat` → `ChatThread({ threadId })`; hosts the panel. |
| `components/ChatOverlayPanel.tsx` **(modify)** | Pass the thread through. |
| `locales/{en,fr,ar}.json` **(modify)** | New strings. |

---

## Task 1: Auto-title — the pure half (server, TDD)

The title must be short, single-line, and in the conversation's own language. Language is detected from the student's **first message**, never from `theses.language` — that field is unreliable, imports default it to `"fr"` even for Arabic theses.

**Files:** Create `src/lib/ai/thread-title.ts`; create `src/__tests__/thread-title.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { buildTitlePrompt, sanitizeTitle } from "../lib/ai/thread-title";

describe("sanitizeTitle", () => {
  it("takes the first line only — models like to add an explanation", () => {
    expect(sanitizeTitle("Plan du chapitre 2\nVoici pourquoi j'ai choisi ce titre.")).toBe("Plan du chapitre 2");
  });

  it("strips surrounding quotes a model wrapped it in", () => {
    expect(sanitizeTitle('"Plan du chapitre 2"')).toBe("Plan du chapitre 2");
    expect(sanitizeTitle("«Plan du chapitre 2»")).toBe("Plan du chapitre 2");
  });

  it("strips a leading label", () => {
    expect(sanitizeTitle("Title: Plan du chapitre 2")).toBe("Plan du chapitre 2");
    expect(sanitizeTitle("Titre : Plan du chapitre 2")).toBe("Plan du chapitre 2");
  });

  it("keeps Arabic untouched", () => {
    expect(sanitizeTitle("خطة الفصل الثاني")).toBe("خطة الفصل الثاني");
  });

  it("truncates on code points so an emoji is never cut in half", () => {
    const out = sanitizeTitle("x".repeat(58) + "😀" + "y".repeat(20));
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
  });

  it("returns null for junk, so the thread stays untitled rather than titled badly", () => {
    expect(sanitizeTitle("")).toBeNull();
    expect(sanitizeTitle("   ")).toBeNull();
    expect(sanitizeTitle("I'm sorry, I can't help with that.")).toBeNull();
  });
});

describe("buildTitlePrompt", () => {
  it("names Arabic explicitly when the message is Arabic", () => {
    // llama-4-scout drifts to English unless the language is stated outright.
    expect(buildTitlePrompt("ما هي خطة الفصل الثاني؟")).toContain("Arabic");
  });

  it("names French for a French message", () => {
    expect(buildTitlePrompt("Comment citer une source ?")).toContain("French");
  });

  it("includes the student's message", () => {
    expect(buildTitlePrompt("Comment citer une source ?")).toContain("Comment citer une source ?");
  });
});
```

- [ ] **Step 2: Run and watch fail**

```bash
npm test -- thread-title
```

- [ ] **Step 3: Implement**

Create `src/lib/ai/thread-title.ts`. It must import only pure helpers — `detectQueryLanguage` from `../rag/text` is db-free and already distinguishes Arabic from Latin. No db imports.

```ts
// Pure logic for naming a conversation. No I/O: the model call itself lives in
// routes/chat.ts, so the prompt and the answer-cleaning are testable on their own.
import { detectQueryLanguage } from "../rag/text";

/** Display budget for a generated title, in code points. */
const TITLE_MAX = 60;

// Refusals and hedges a small model emits when it doesn't understand the ask.
// A thread titled "I'm sorry, I can't help with that" is worse than an untitled
// one, which falls back to the student's own first message.
const JUNK = /^(i'?m sorry|sorry|i can'?t|as an ai|here (is|are)|sure[,!]|d'accord|désolé)/i;

/**
 * Clean a model's answer into a title, or null if it isn't usable.
 *
 * Everything here exists because a small, cheap model was observed doing it:
 * adding an explanation on a second line, wrapping the title in quotes, or
 * prefixing "Title:".
 */
export function sanitizeTitle(raw: string): string | null {
  let s = (raw ?? "").split("\n")[0].trim();
  s = s.replace(/^(title|titre|عنوان)\s*[:：]\s*/i, "").trim();
  s = s.replace(/^["'«“”‘’]+|["'«»“”‘’]+$/g, "").trim();
  if (!s || JUNK.test(s)) return null;
  const cps = Array.from(s);
  // Code points, not UTF-16 units: a cut inside a surrogate pair leaves a lone
  // surrogate, which is invalid UTF-8 the moment it hits Postgres or JSON.
  return cps.length <= TITLE_MAX ? s : cps.slice(0, TITLE_MAX - 1).join("").trimEnd() + "…";
}

/**
 * The one-shot prompt. The target language is named OUTRIGHT rather than left to
 * the model to infer — the suggestions model (Workers AI llama-4-scout) drifts to
 * English on Arabic input unless told, a quirk already documented for the
 * composer chips.
 */
export function buildTitlePrompt(firstUserMessage: string): string {
  const lang = detectQueryLanguage(firstUserMessage);
  const name = lang === "ar" ? "Arabic" : lang === "fr" ? "French" : "English";
  return [
    `Write a title of at most 6 words for a conversation that starts with the message below.`,
    `Write it in ${name}.`,
    `Reply with the title alone — no quotes, no preamble, no explanation.`,
    ``,
    firstUserMessage,
  ].join("\n");
}
```

- [ ] **Step 4: Run and watch pass** — `npm test -- thread-title`, then full `npm test` → 969 / 85 files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/thread-title.ts src/__tests__/thread-title.test.ts
git commit -m "feat(chat): pure prompt + answer cleaning for thread auto-titles"
```

---

## Task 2: Close the §7b gap — `pending_tool_actions.thread_id`

Confirming a parked destructive action currently resolves its reply thread via
`newestThreadForThesis`, not the thread the action was proposed in. Harmless
while a thesis has one thread; wrong the moment this plan ships a ＋ button.

**Files:** `src/db/schema.ts`, `sql/2026-08-10-pending-actions-thread.sql` (new), `src/routes/chat.ts`.

- [ ] **Step 1: Add the column to the Drizzle table**

In `src/db/schema.ts`, add to `pendingToolActions`:

```ts
  // The conversation the action was proposed in. Without it, confirming an
  // action resolved the reply thread by "newest for this thesis", so an approval
  // in one conversation could stream its reply into another.
  threadId: uuid("thread_id"),
```

- [ ] **Step 2: Write and apply the migration**

⚠️ Do **not** use `drizzle-kit` — its snapshot is years behind this database and `generate` emits `CREATE TABLE` for tables that already exist. Hand-write `sql/2026-08-10-pending-actions-thread.sql`:

```sql
-- Additive and backwards compatible: a nullable column the deployed server
-- neither reads nor writes. Nothing near `templates`, which sits at attnum
-- 1600/1600 and is why ensureSchema aborts on boot.
BEGIN;
ALTER TABLE pending_tool_actions ADD COLUMN IF NOT EXISTS thread_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pending_tool_actions_thread_id_fk') THEN
    ALTER TABLE pending_tool_actions
      ADD CONSTRAINT pending_tool_actions_thread_id_fk
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE;
  END IF;
END $$;
COMMIT;
```

Apply it the same way plan 1's migration was applied (a `node -e` script reading the file and running it through `pg`), then verify the column and constraint exist.

- [ ] **Step 3: Set it when parking, read it when resuming**

In `src/routes/chat.ts`, wherever a row is inserted into `pendingToolActions`, add `threadId`. In `/confirm-action` and `/cancel-action`, replace the `newestThreadForThesis(userId, action.thesisId)` resolution with `action.threadId` when present, falling back to the old path only when it is null (rows parked before this change):

```ts
  // Prefer the thread the action was actually proposed in. The fallback covers
  // rows parked before thread_id existed; it can be deleted with the shim.
  const thread = action.threadId
    ? await getThread(userId, action.threadId)
    : await newestThreadForThesis(userId, action.thesisId);
  if (!thread) return c.json({ error: "Conversation not found" }, 404);
```

- [ ] **Step 4: Verify + commit**

`npx tsc --noEmit` clean, `npm test` → 969 / 85.

```bash
git add src/db/schema.ts sql/2026-08-10-pending-actions-thread.sql src/routes/chat.ts
git commit -m "fix(chat): park pending actions against their thread, not just the thesis"
```

---

## Task 3: Auto-title — wire it into the stream

**Files:** `src/routes/chat.ts`, `src/lib/ai/tool-loop.ts` (frame constants).

- [ ] **Step 1: Add the frame**

Alongside the existing `[[MODK_FILE]]` / `[[MODK_IMG]]` constants in `src/lib/ai/tool-loop.ts`:

```ts
// Emitted once, mid-stream, when a thread gets its first generated title, so the
// history panel updates live instead of waiting for a refetch.
export const TITLE_FRAME_OPEN = "[[MODK_TITLE]]";
export const TITLE_FRAME_CLOSE = "[[/MODK_TITLE]]";
```

Add `MODK_TITLE` to `stripOwnFrames` in `src/lib/ai/control-frames.ts` — both the closed and the dangling-to-end variants, matching the existing entries. **This matters:** an unstripped frame would otherwise be shown to the student as literal text and indexed into `search_text`.

- [ ] **Step 2: Title after the first assistant turn**

In `/stream`, after the assistant message is saved.

⚠️ **This must be `await`ed — do NOT copy `maybeSummarize`'s fire-and-forget
shape.** Verified against Hono's source: `streamText` calls `stream.close()` in a
`finally` as soon as the handler callback's promise settles, and it does not wait
for un-awaited promises. `StreamingApi.write()` swallows a write-after-close in an
empty `catch`, so a deferred write neither throws nor arrives — the title frame
would silently never reach the client. `maybeSummarize` gets away with it only
because it never touches the stream.

```ts
    // First real exchange on an untitled thread → name it. Awaited, not
    // fire-and-forget: the frame has to be written before streamText closes the
    // stream, and a late write is silently dropped. Failure is still harmless —
    // the title stays NULL and the panel falls back to the student's own first
    // message — so this is wrapped rather than allowed to fail the turn.
    if (!stopped) {
      try {
        const title = await maybeTitleThread(threadId, message, ai, summarizeModelToUse);
        if (title) stream.write(streamSafe(`${TITLE_FRAME_OPEN}${JSON.stringify({ threadId, title })}${TITLE_FRAME_CLOSE}`));
      } catch (e: any) {
        console.error("title error:", e?.message);
      }
    }
```

Note the DB-side title write still happens on a stopped turn; only the live
stream notification is skipped, because there is no stream left to notify.

Implement `maybeTitleThread` next to the other helpers in `chat.ts`:

```ts
// Generate a title for a thread that has none. Returns null when the thread is
// already titled, when the model refuses, or on any error — the caller treats a
// null as "leave it untitled".
async function maybeTitleThread(threadId: string, firstMessage: string, ai: AIProvider, model?: string): Promise<string | null> {
  // An image-only send has an empty message, and its regenerate re-sends the
  // same empty text — there is nothing to title from.
  if (!firstMessage?.trim()) return null;
  const [row] = await db.select({ title: chatThreads.title }).from(chatThreads).where(eq(chatThreads.id, threadId));
  if (!row || row.title) return null;
  const answer = await ai.chat([{ role: "user", content: buildTitlePrompt(firstMessage) }], { model });
  const title = sanitizeTitle(typeof answer === "string" ? answer : answer?.content ?? "");
  if (!title) return null;
  await db.update(chatThreads).set({ title, updatedAt: new Date() }).where(eq(chatThreads.id, threadId));
  return title;
}
```

Match `ai.chat`'s real signature — read how `suggestions` calls the provider in this same file and mirror it rather than assuming the shape above.

- [ ] **Step 3: Verify by hand**

Start the server, send a first message on a fresh thread through `/api/chat/stream`, and confirm: the response contains one `[[MODK_TITLE]]` frame; `SELECT title FROM chat_threads WHERE id = …` is populated; a second message on the same thread emits **no** frame.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/tool-loop.ts src/lib/ai/control-frames.ts src/routes/chat.ts
git commit -m "feat(chat): auto-title a thread on its first exchange"
```

---

## Task 4: `POST /api/threads/for-thesis` — the Writer's entry point

Tapping ✦ in the Writer must reopen the most recent conversation for that thesis. That is exactly `newestThreadForThesis`, which is already written, ownership-checked and null-ordering-correct — expose it rather than reimplementing the choice client-side.

**Files:** `src/routes/chat-threads.ts`.

- [ ] **Step 1: Add the route** (before `/:id`, like `/search`)

```ts
// The Writer's ✦ entry point: the conversation this thesis is "currently" in,
// created on demand. Deliberately a server call rather than the client picking
// from GET / — listThreads ranks a brand-new empty thread FIRST (the student
// just tapped ＋ and wants to see it), whereas here the right answer is the
// thread with something in it. Same question, opposite orderings.
chatThreadRoutes.post("/for-thesis", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  if (typeof body?.thesisId !== "string") return c.json({ error: "thesisId required" }, 400);
  try {
    return c.json(await newestThreadForThesis(userId, body.thesisId));
  } catch (e) {
    if (e instanceof ThreadAccessError) return c.json({ error: "Thesis not found" }, 404);
    throw e;
  }
});
```

Add `newestThreadForThesis` to the file's import.

- [ ] **Step 2: Verify + commit** — boot, confirm 401 unauthenticated; `npx tsc --noEmit`; `npm test`.

```bash
git add src/routes/chat-threads.ts
git commit -m "feat(chat): POST /api/threads/for-thesis"
```

**Server work ends here.** Everything below is `~/modakerati`.

---

## Task 5: Branch the app, re-key the device cache

**Files:** `lib/chat-cache.ts`.

- [ ] **Step 1: Branch**

```bash
cd ~/modakerati && git checkout -b feat/chat-threads-app
```

- [ ] **Step 2: Re-key the tables**

`lib/chat-cache.ts` keys `chat_messages` and `chat_sync` on `thesis_id`. Change both to `thread_id`, including the index (`idx_chat_thread_created ON chat_messages (thread_id, created_at)`) and every query and parameter name.

**Migrate by dropping, not converting.** This is a rebuildable device cache, and the old rows have no thread to belong to:

```ts
// The cache is keyed by thread now. Old rows are keyed by thesis and cannot be
// mapped on-device — the thread ids live on the server. Dropping is correct and
// costs the student one refetch of the latest page; converting would mean
// inventing thread ids that don't exist.
await db.execAsync(`DROP TABLE IF EXISTS chat_messages; DROP TABLE IF EXISTS chat_sync;`);
```

Run it once, before the `CREATE TABLE` statements, guarded by a version marker so it does not run on every open — follow whatever the file already does for setup, and if there is no version mechanism, add a tiny `chat_cache_meta(version INTEGER)` table.

- [ ] **Step 3: Verify**

`npx tsc --noEmit` clean. Then **run the app**: open a chat, confirm history loads from the server, background and reopen, confirm it loads instantly from cache.

- [ ] **Step 4: Commit**

```bash
git add lib/chat-cache.ts
git commit -m "feat(chat): device cache keys off thread"
```

---

## Task 6: API client

**Files:** `lib/api.ts`.

- [ ] **Step 1: Add thread types + calls**

```ts
export interface ChatThread {
  id: string;
  thesisId: string | null;
  title: string | null;
  pinned: boolean;
  archivedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ThreadSearchResult {
  thread: ChatThread;
  messageId: string;
  snippet: string;
  createdAt: string | null;
}

export async function listThreads(opts?: { thesisId?: string; archived?: boolean }) {
  const p = new URLSearchParams();
  if (opts?.thesisId) p.set("thesisId", opts.thesisId);
  if (opts?.archived) p.set("archived", "1");
  const q = p.toString();
  return apiGet<ChatThread[]>(`/api/threads${q ? `?${q}` : ""}`);
}

export async function createThread(thesisId?: string | null) {
  return apiPost<ChatThread>("/api/threads", { thesisId: thesisId ?? null });
}

/** The Writer's ✦ entry: the conversation this thesis is currently in. */
export async function threadForThesis(thesisId: string) {
  return apiPost<ChatThread>("/api/threads/for-thesis", { thesisId });
}

export async function patchThread(threadId: string, patch: { title?: string | null; pinned?: boolean; archived?: boolean }) {
  return apiPatch<ChatThread>(`/api/threads/${threadId}`, patch);
}

export async function deleteThread(threadId: string) {
  return apiDelete<{ success: true }>(`/api/threads/${threadId}`);
}

export async function searchThreads(q: string) {
  return apiGet<ThreadSearchResult[]>(`/api/threads/search?q=${encodeURIComponent(q)}`);
}
```

If `apiPatch` / `apiDelete` don't exist, add them beside `apiGet`/`apiPost` following the exact same shape (auth header, error handling, the ASCII-safe JSON handling this file already does).

- [ ] **Step 2: Re-point the chat calls**

`getChatHistory` and `getChatHistoryPage` take `threadId` and hit `/api/threads/${threadId}/messages`. `chatSend` and `chatSendStream` send `threadId` in the body instead of `thesisId`.

- [ ] **Step 3: Parse the title frame**

In `postChatStream`, add `onTitle?: (p: { threadId: string; title: string }) => void` to `ChatStreamHandlers` and parse `[[MODK_TITLE]]…[[/MODK_TITLE]]` exactly like the existing `[[MODK_FILE]]` handling — including stripping it from the visible text.

- [ ] **Step 4: Do not commit yet.**

`npx tsc --noEmit` will report errors at every call site — that is expected, and
they are fixed in Tasks 7 and 8. **Tasks 6, 7 and 8 are one commit**, made at the
end of Task 8, because the re-key cannot compile in pieces. Do not try to make
this file green on its own.

---

## Task 7: `chat-threads-store`

**Files:** Create `stores/chat-threads-store.ts`; create `lib/thread-groups.ts`.

- [ ] **Step 1: The pure grouping helper**

`lib/thread-groups.ts` — sections for the panel. Grouping is client-side **on purpose**: the server's timezone is not the student's, and a thread that was "today" in Casablanca must not read as yesterday because the box runs UTC.

```ts
import type { ChatThread } from "@/lib/api";

export interface ThreadSection {
  /** "pinned" | "none" | a thesisId */
  key: string;
  threads: ChatThread[];
}

/**
 * Panel sections: pinned first, then one per thesis, then unattached.
 * The thesis IS the folder — there is no folders table by design.
 */
export function groupThreads(threads: ChatThread[]): ThreadSection[] {
  const pinned = threads.filter((t) => t.pinned);
  const rest = threads.filter((t) => !t.pinned);
  const byThesis = new Map<string, ChatThread[]>();
  for (const t of rest) {
    const k = t.thesisId ?? "none";
    const list = byThesis.get(k);
    if (list) list.push(t); else byThesis.set(k, [t]);
  }
  const sections: ThreadSection[] = [];
  if (pinned.length) sections.push({ key: "pinned", threads: pinned });
  for (const [key, list] of byThesis) if (key !== "none") sections.push({ key, threads: list });
  const none = byThesis.get("none");
  if (none?.length) sections.push({ key: "none", threads: none });
  return sections;
}
```

Note the server already returns threads in display order (`sortThreads`), so this only partitions — it must not re-sort.

**Resolving a contradiction in the spec.** §2's v1 baseline lists "date grouping",
but §4.2's chosen design is "the thesis IS the folder", and the agreed wireframe
had sections for Pinned / each thesis / No thesis — with no date bands. Thesis
sections **supersede** date sections: two grouping axes stacked on one list is
exactly the confusion that got folders cut. Recency still reads clearly, because
`sortThreads` orders within each section by last activity and every row shows a
relative timestamp. If the list later feels undated, adding date bands *inside* a
thesis section is a clean follow-up; do not build both now.

- [ ] **Step 2: The store**

Follow the exact conventions of `stores/chat-store.ts`: a Zustand `create`, plain state + actions.

⚠️ **Never return a fresh object or array literal from a selector** — that makes `useSyncExternalStore` see a new snapshot every render and throws "Maximum update depth exceeded". Use module-level stable empties, as `chat-store.ts` does with `EMPTY_MESSAGES`.

State: `threads: ChatThread[]`, `currentThreadId: string | null`, `loading: boolean`, `query: string`, `results: ThreadSearchResult[]`, `searching: boolean`.
Actions: `load(thesisId?)`, `setCurrent(id)`, `newThread(thesisId)`, `rename(id, title)`, `setPinned(id, v)`, `setArchived(id, v)`, `remove(id)`, `search(q)`, `applyTitle(threadId, title)` (for the `[[MODK_TITLE]]` frame).

Every mutation is optimistic then reconciled, matching how the app treats chat sends.

- [ ] **Step 3:** `npx tsc --noEmit`; commit with Task 8 if call sites are still broken.

---

## Task 8: Re-key types, chat store and ai-service

**Files:** `types/chat.ts`, `stores/chat-store.ts`, `lib/ai-service.ts`.

- [ ] **Step 1:** `types/chat.ts` — `ChatMessage.thesisId` → `threadId`.

- [ ] **Step 2:** `stores/chat-store.ts` — re-key `messages`, `hasMoreOlder`, `loadingOlder` from thesisId to threadId, and every function's first parameter.

**Leave `docChanges` keyed by `thesisId`.** The "Undo AI changes" chip points at a document history checkpoint, which belongs to the *document*, not the conversation — two threads editing one thesis must share it. This is deliberate; do not "fix" the inconsistency.

Everything else in this store — turn ownership (`beginTurn`/`isTurnActive`/`endTurn`), unconditional Stop, the tool trace, the reasoning clock, the duplicate-send guard — is untouched. It has no opinion about threads.

- [ ] **Step 3:** `lib/ai-service.ts` — `sendMessageToAI`, `retryFailedMessage`, `regenerateLastResponse`, `loadInitialMessages`, `loadOlderMessages`, `persistCache`, `approvePendingAction`, `declinePendingAction`, `syncLatestFromServer`, `mapServerMessages` all take/produce `threadId`. Wire the new `onTitle` handler to `chat-threads-store`'s `applyTitle`.

- [ ] **Step 4:** `npx tsc --noEmit` must now be clean across Tasks 6–8 together.

- [ ] **Step 5: Commit** (one commit for 6–8 if they only compile together)

```bash
git add lib/api.ts stores/chat-threads-store.ts lib/thread-groups.ts types/chat.ts stores/chat-store.ts lib/ai-service.ts
git commit -m "feat(chat): app keys off threadId"
```

---

## Task 9: The history panel

**Files:** Create `components/chat/ChatHistoryPanel.tsx`; modify `locales/{en,fr,ar}.json`.

- [ ] **Step 1: The component**

A slide-in over the chat, opened by a header button. Structure:

```tsx
export function ChatHistoryPanel({ visible, thesisId, onClose, onPick }: {
  visible: boolean;
  /** Used only to pre-attach a thread created with ＋. */
  thesisId: string | null;
  onClose: () => void;
  onPick: (threadId: string) => void;
}) {
  // threads, query, results, loading come from chat-threads-store — select
  // PRIMITIVES or stable references only. A selector returning a fresh array
  // literal makes useSyncExternalStore see a new snapshot every render and
  // throws "Maximum update depth exceeded".
  // sections = useMemo(() => groupThreads(threads), [threads])
  //
  // Render, top to bottom:
  //   search field  → store.search(q), debounced
  //   ＋ New chat    → store.newThread(thesisId) then onPick(id)
  //   loading       → layout-shaped skeleton, ONE SkeletonGroup pulse, never a spinner
  //   query set     → flat result rows (thread title + snippet)
  //   otherwise     → SectionList over `sections`
  //   empty         → t("chat.threads.empty")
}
```

Row: title — falling back to `t("chat.threads.untitled")` when `title` is null —
plus relative time and a 📄 badge when attached. Long-press opens rename / pin /
archive / delete. Section header: `t("chat.threads.pinned")`, the thesis title,
or `t("chat.threads.noThesis")`.

Every colour comes from `useThemeColors`, never a literal; every string from
`useTranslation`.

Follow the project's conventions: `useThemeColors` for every colour (no literals), `useTranslation` for every string, and the existing skeleton pattern for the loading state — a layout-shaped skeleton, never a spinner, and only one `SkeletonGroup` pulse per screen.

⚠️ RTL: Arabic titles must render with proper bidi isolation, as the chat bubbles already do.

- [ ] **Step 2: Strings**

Add to all three locale files, **surgically** (duplicate keys exist — never rewrite the file):

`chat.threads.title`, `chat.threads.new`, `chat.threads.search`, `chat.threads.pinned`, `chat.threads.noThesis`, `chat.threads.untitled`, `chat.threads.rename`, `chat.threads.pin`, `chat.threads.unpin`, `chat.threads.archive`, `chat.threads.unarchive`, `chat.threads.delete`, `chat.threads.deleteConfirm`, `chat.threads.empty`, `chat.threads.archived`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit`, then **run the app**: open the panel, confirm sections, search, pin, rename and delete all work and that Arabic renders right-to-left.

- [ ] **Step 4: Commit**

```bash
git add components/chat/ChatHistoryPanel.tsx locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(chat): conversation history panel"
```

---

## Task 10: Wire the chat screen

**Files:** `app/(app)/chat.tsx`, `components/ChatOverlayPanel.tsx`.

- [ ] **Step 1:** `ThesisChat({ thesisId, thesisTitle, variant, onClose })` becomes `ChatThread({ threadId, title, variant, onClose })`. Keep a `ThesisChat` wrapper that resolves `threadForThesis(thesisId)` on mount and renders `ChatThread`, so `ChatOverlayPanel` and the route need no restructuring.

- [ ] **Step 2:** Add the header button that opens `ChatHistoryPanel`, and render the panel inside `ChatThread` so it works in both the screen and the Writer overlay.

- [ ] **Step 3:** The default screen (`app/(app)/chat.tsx`'s default export) resolves the current thesis's thread; with no thesis it still shows `EmptyWriter` (unattached chats arrive in plan 3).

- [ ] **Step 4: Verify — this is the real gate**

`npx tsc --noEmit` clean, then run the app and walk the whole flow:
1. Open chat from the drawer → the last conversation for the thesis opens where you left it.
2. Send a message → it streams; within a few seconds the panel shows a generated title in the right language.
3. ＋ New chat → an empty conversation; send a message; both now appear in the panel.
4. Switch between them → each keeps its own history.
5. Open the Writer, tap ✦ → the same conversation, with the panel available.
6. Search a word you used → the right conversation with a snippet.
7. Pin, archive, rename, delete → all reflected immediately.
8. Kill and reopen the app → the current conversation is still there, loaded from cache.
9. Airplane mode → cached history shows; sending fails as a failed bubble with Retry.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/chat.tsx" components/ChatOverlayPanel.tsx
git commit -m "feat(chat): chat screen and Writer overlay open a thread"
```

---

## Done when

- Server: `npm test` → 969 / 85 files, `npx tsc --noEmit` clean.
- App: `npx tsc --noEmit` clean, and all nine flows in Task 10 Step 4 pass on a real device.
- A thread gets a title in its own language after its first exchange.
- Approving a destructive action replies in the conversation it was proposed in.
- Old app builds still work through the compatibility shim.
