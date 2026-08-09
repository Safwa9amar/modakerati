# Chat Threads — Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `~/modakerati-server` a real conversation model — a `chat_threads` table, a `/api/threads` API, and a backfill that turns every existing per-thesis chat log into one thread — with zero visible change for any app build in the wild.

**Architecture:** Threads are user-owned rows with an optional `thesis_id`. All decision logic (search-text extraction, title fallback, sort order, patch validation, shim resolution) lives in pure functions in `src/lib/chat-threads.ts` so it can be unit-tested without a database; the database access sits behind `src/lib/chat-threads-db.ts`; the Hono handlers in `src/routes/chat-threads.ts` stay thin. The existing thesis-keyed endpoints survive as a compatibility shim that resolves "the newest thread for this thesis", so this whole plan can deploy before the app knows threads exist.

**Tech Stack:** TypeScript, Hono, Drizzle ORM 0.45 / drizzle-kit 0.31, PostgreSQL (Supabase), vitest.

---

## Scope

This is **plan 1 of 4**, covering slices 1–2 of [the design spec](../specs/2026-08-09-chat-threads-design.md). Plans that follow:

- **Plan 2** — app re-key, history panel, auto-title (slices 3–4)
- **Plan 3** — unattached mode (slice 5)
- **Plan 4** — cleanup: drop the shim and `chat_messages.thesis_id` (slice 6)

Nothing in this plan changes what a student sees. That is the point: it deploys on its own, and the app catches up in plan 2.

## Conventions for every task

- Run commands from `~/modakerati-server` unless stated otherwise.
- Tests live in `src/__tests__/*.test.ts` (vitest, `globals: true`). Run with `npm test`.
- **Every commit message ends with this trailer** (blank line before it):
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```
- `git add` exact paths, never `-A`. Multiple sessions may share this tree.

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/ai/control-frames.ts` **(new)** | Frame stripping, extracted from `tool-loop.ts` as a leaf with no db-touching imports so pure modules can use it. |
| `src/lib/chat-threads.ts` **(new)** | Pure logic only. No imports from `../db`, and no *transitive* reach into it either — verified by importing it with an empty environment. Search-text extraction, title fallback, sort order, patch validation, shim resolution, search-query folding. |
| `src/lib/chat-threads-db.ts` **(new)** | Every query that touches `chat_threads`. Always filters by `userId`. |
| `src/routes/chat-threads.ts` **(new)** | The `/api/threads` Hono handlers. Thin — parse, delegate, respond. |
| `src/__tests__/chat-threads.test.ts` **(new)** | Unit tests for `chat-threads.ts`. |
| `scripts/backfill-chat-threads.ts` **(new)** | One-shot, idempotent backfill of existing chats. |
| `scripts/probe-chat-threads.ts` **(new)** | Manual end-to-end verification against a live database, incl. ownership isolation. Follows the existing `probe-*.ts` convention. |
| `src/db/schema.ts` **(modify)** | `chatThreads` table; `chatMessages` gains `threadId` + `searchText`, loses `NOT NULL` on `thesisId`. |
| `src/db/norm-profiles.ts` **(modify)** | `chatSummaries` gains `threadId`. |
| `src/index.ts` **(modify)** | Mount `/api/threads`. |
| `src/routes/chat.ts` **(modify)** | Write `threadId` + `searchText` on every insert; shim the thesis-keyed endpoints; fix two live bugs. |
| `src/lib/chat-memory.ts` **(modify)** | `buildChatContext` / `maybeSummarize` key off a thread. |

---

## Task 1: `buildSearchText` — the search index's input

`content` cannot be indexed directly. It carries control frames, and two of them
(`[[MODK_IMG]]`, `[[MODK_FILE]]`) hold URLs and payload metadata that are useless
in a search index and bloat it badly.

**The trap:** the existing `stripControlFrames` does **not** remove `MODK_IMG` or
`MODK_FILE` — it only handles `THINK`, `ASK`, `DOCCHANGES`, `CONFIRM` and `TOOL`.
Image frames have their own stripper (`stripImageFrames`) and file frames have
none. `buildSearchText` must handle all three groups or picture URLs end up in
the index.

**A second trap, found in review:** `stripControlFrames` lives in
`src/lib/ai/tool-loop.ts`, which transitively imports `../../db` (constructing a
live `pg.Pool`) and `src/lib/supabase.ts`, which calls `createClient()` at module
scope. Importing it from a "pure logic" module makes that module throw
`supabaseUrl is required` in any environment without a populated `.env` — so
every pure unit test in this file would silently depend on Supabase config. The
frame strippers must be extracted to a leaf module first.

**Files:**
- Create: `src/lib/ai/control-frames.ts` (leaf — no db-touching imports)
- Modify: `src/lib/ai/tool-loop.ts` (move the strippers out, re-export)
- Create: `src/lib/chat-threads.ts`
- Test: `src/__tests__/chat-threads.test.ts`

- [ ] **Step 0: Extract the frame strippers to a leaf module**

Move `stripOwnFrames` and `stripControlFrames` verbatim out of
`src/lib/ai/tool-loop.ts` into a new `src/lib/ai/control-frames.ts`. It may
import `stripLeakedReasoning` from `./cot-leak` — confirm `cot-leak.ts` is itself
db-free before relying on that.

Re-export `stripControlFrames` from `tool-loop.ts` so every existing importer
keeps working untouched:

```bash
grep -rn "stripControlFrames" src/ --include=*.ts
```

Prove the leaf is genuinely importable with no environment at all:

```bash
env -i PATH="$PATH" npx tsx -e 'import("./src/lib/chat-threads.ts").then(m => console.log(m.buildSearchText("test")))'
```

Expected: prints `test`. If it throws, the extraction is incomplete.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/chat-threads.test.ts`. Note there is deliberately **no**
`import "dotenv/config"` — needing one would mean Step 0 didn't work:

```ts
import { describe, it, expect } from "vitest";
import { buildSearchText } from "../lib/chat-threads";

describe("buildSearchText", () => {
  it("keeps the student's prose", () => {
    expect(buildSearchText("Comment citer une source APA ?")).toBe("comment citer une source apa ?");
  });

  it("folds Arabic diacritics so a search without tashkeel still matches", () => {
    // foldText strips tashkeel; both spellings must land on the same index text.
    expect(buildSearchText("خُطَّة البحث")).toBe(buildSearchText("خطة البحث"));
  });

  it("folds Latin diacritics too — foldText strips the cedilla, so ça indexes as ca", () => {
    expect(buildSearchText("ça")).toBe("ca");
  });

  it("drops [[MODK_IMG]] frames — a picture URL is not searchable text", () => {
    const raw = 'Regarde ça\n[[MODK_IMG]]{"kind":"image","url":"https://x/y.jpg","mime":"image/jpeg"}[[/MODK_IMG]]';
    expect(buildSearchText(raw)).toBe("regarde ca");
  });

  it("drops [[MODK_FILE]] frames", () => {
    const raw = 'Voici ton export\n[[MODK_FILE]]{"kind":"file","url":"https://x/t.docx","filename":"t.docx"}[[/MODK_FILE]]';
    expect(buildSearchText(raw)).toBe("voici ton export");
  });

  it("drops the frames stripControlFrames already knows about", () => {
    const raw = "Réponse[[MODK_TOOL]]{\"name\":\"edit_block\"}[[/MODK_TOOL]]";
    expect(buildSearchText(raw)).toBe("reponse"); // é folds to e
  });

  it("drops an UNCLOSED image frame — a stream cut mid-frame must not leak a URL", () => {
    const raw = 'Regarde\n[[MODK_IMG]]{"kind":"image","url":"https://x/y.jpg"';
    expect(buildSearchText(raw)).toBe("regarde");
  });

  it("collapses whitespace so multi-line messages index as one line", () => {
    expect(buildSearchText("bonjour\n\n  le   monde")).toBe("bonjour le monde");
  });

  it("returns an empty string for a message that was nothing but frames", () => {
    expect(buildSearchText("[[MODK_IMG]]{}[[/MODK_IMG]]")).toBe("");
  });

  it("keeps prose after a BARE frame token — a student quoting the marker must not lose their question", () => {
    const raw = "Le format est [[MODK_IMG]] puis du texte.\nMa vraie question : comment citer une source APA ?";
    expect(buildSearchText(raw)).toContain("comment citer une source apa");
  });

  it("drops an unclosed FILE frame the same way as an image one", () => {
    const raw = 'Ton export\n[[MODK_FILE]]{"kind":"file","url":"https://x/t.docx"';
    expect(buildSearchText(raw)).toBe("ton export");
  });

  it("drops two adjacent frames — a multi-image message indexes as its caption alone", () => {
    const raw = 'Regarde\n[[MODK_IMG]]{"url":"https://x/1.jpg"}[[/MODK_IMG]]\n[[MODK_IMG]]{"url":"https://x/2.jpg"}[[/MODK_IMG]]\nmerci';
    expect(buildSearchText(raw)).toBe("regarde merci");
  });

  it("returns an empty string for whitespace-only content", () => {
    expect(buildSearchText("   \n\t ")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -- chat-threads
```

Expected: FAIL — `Failed to resolve import "../lib/chat-threads"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/chat-threads.ts`:

```ts
// Pure logic for chat threads. NO I/O and NO imports from ../db — everything
// here is unit-tested without a database, which is why the route handlers and
// the db layer stay as thin as they do.
// control-frames, NOT tool-loop: tool-loop reaches the db pool and builds the
// Supabase client at module scope, which would make this "pure" module throw on
// import wherever there is no .env — CI included.
import { stripControlFrames } from "./ai/control-frames";
import { foldText } from "./rag/text";

// Image and file frames. NOT covered by stripControlFrames — it handles THINK /
// ASK / DOCCHANGES / CONFIRM / TOOL only. Leaving them in would put storage URLs
// and payload metadata straight into the search index.
//
// The second alternative catches a frame left open by a stream that died
// mid-write. The `\s*\{` guard is what makes it safe: a real payload is JSON, so
// requiring one distinguishes a truncated frame from a bare [[MODK_IMG]] token a
// student typed or pasted. Without it, quoting the marker mid-sentence silently
// erased every word after it from the index.
const IMG_FRAME_RE = /\[\[MODK_IMG\]\](?:[\s\S]*?\[\[\/MODK_IMG\]\]|\s*\{[\s\S]*$)/g;
const FILE_FRAME_RE = /\[\[MODK_FILE\]\](?:[\s\S]*?\[\[\/MODK_FILE\]\]|\s*\{[\s\S]*$)/g;

/**
 * The text a chat message is SEARCHED by: its prose, with every control frame
 * removed and diacritics folded, collapsed onto one line.
 *
 * Folding matters most for Arabic: a student types خطة, the stored message says
 * خُطَّة, and an unfolded index would never match. foldText applies the same NFKD
 * + tashkeel + tatweel rules the RAG layer already uses, so chat search and
 * document search agree about what two strings being "the same" means.
 */
export function buildSearchText(content: string): string {
  const prose = stripControlFrames(content.replace(IMG_FRAME_RE, "").replace(FILE_FRAME_RE, ""));
  return foldText(prose).replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -- chat-threads
```

Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-threads.ts src/__tests__/chat-threads.test.ts
git commit -m "feat(chat): buildSearchText — frame-free, folded text for chat search

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `fallbackTitle` and `sortThreads`

A thread's `title` is NULL until the auto-titler runs (plan 2), and titling can
fail. The list must never show a blank row, so it falls back to the first user
message. Sort order is what makes the list feel right: pinned first, then most
recent — where "recent" for a thread with no messages yet means when it was
created, so a brand-new empty chat appears at the top rather than the bottom.

**Files:**
- Modify: `src/lib/chat-threads.ts`
- Test: `src/__tests__/chat-threads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/chat-threads.test.ts`:

```ts
import { fallbackTitle, sortThreads } from "../lib/chat-threads";

describe("fallbackTitle", () => {
  it("uses the first user message verbatim when it is short", () => {
    expect(fallbackTitle("Comment citer une source ?")).toBe("Comment citer une source ?");
  });

  it("does NOT fold case or diacritics — this is display text, not index text", () => {
    expect(fallbackTitle("خُطَّة البحث")).toBe("خُطَّة البحث");
  });

  it("truncates a long message on a character budget and marks the cut", () => {
    const long = "a".repeat(200);
    const out = fallbackTitle(long);
    expect(out).toHaveLength(60);
    expect(out.endsWith("…")).toBe(true);
  });

  it("strips frames so a photo-only message does not title the thread with a URL", () => {
    const raw = 'Regarde\n[[MODK_IMG]]{"url":"https://x/y.jpg"}[[/MODK_IMG]]';
    expect(fallbackTitle(raw)).toBe("Regarde");
  });

  it("returns an empty string when there is no prose at all", () => {
    expect(fallbackTitle("[[MODK_IMG]]{}[[/MODK_IMG]]")).toBe("");
    expect(fallbackTitle("   ")).toBe("");
  });
});

describe("sortThreads", () => {
  const t = (id: string, pinned: boolean, last: string | null, created: string) => ({
    id,
    pinned,
    lastMessageAt: last ? new Date(last) : null,
    createdAt: new Date(created),
  });

  it("puts pinned threads first even when they are older", () => {
    const rows = [
      t("new", false, "2026-08-09T10:00:00Z", "2026-08-09T09:00:00Z"),
      t("pinned-old", true, "2026-01-01T10:00:00Z", "2026-01-01T09:00:00Z"),
    ];
    expect(sortThreads(rows).map((r) => r.id)).toEqual(["pinned-old", "new"]);
  });

  it("orders by last message, most recent first", () => {
    const rows = [
      t("older", false, "2026-08-01T10:00:00Z", "2026-08-01T09:00:00Z"),
      t("newer", false, "2026-08-09T10:00:00Z", "2026-08-09T09:00:00Z"),
    ];
    expect(sortThreads(rows).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("ranks an empty thread by its creation time, so a NEW chat sits at the top", () => {
    // The whole point: tap +, get an empty thread, and see it where you expect.
    const rows = [
      t("has-messages", false, "2026-08-09T08:00:00Z", "2026-08-01T09:00:00Z"),
      t("brand-new", false, null, "2026-08-09T12:00:00Z"),
    ];
    expect(sortThreads(rows).map((r) => r.id)).toEqual(["brand-new", "has-messages"]);
  });

  it("does not mutate the input array", () => {
    const rows = [
      t("a", false, "2026-08-01T10:00:00Z", "2026-08-01T09:00:00Z"),
      t("b", false, "2026-08-09T10:00:00Z", "2026-08-09T09:00:00Z"),
    ];
    sortThreads(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npm test -- chat-threads
```

Expected: FAIL — `fallbackTitle is not exported` / `sortThreads is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/chat-threads.ts`:

```ts
/** Display budget for a title derived from a message, including the ellipsis. */
const FALLBACK_TITLE_MAX = 60;

/**
 * The title a thread shows before (or instead of) an auto-generated one: the
 * student's first message, frames removed. Deliberately NOT folded — this is
 * text a human reads, so case and Arabic diacritics stay exactly as typed.
 *
 * Returns "" when there is no prose (a photo-only first message). The caller
 * decides what an untitled thread looks like; this function does not invent one.
 */
export function fallbackTitle(firstUserMessage: string): string {
  const prose = stripControlFrames(
    firstUserMessage.replace(IMG_FRAME_RE, "").replace(FILE_FRAME_RE, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  if (prose.length <= FALLBACK_TITLE_MAX) return prose;
  return prose.slice(0, FALLBACK_TITLE_MAX - 1).trimEnd() + "…";
}

export interface SortableThread {
  pinned: boolean;
  lastMessageAt: Date | null;
  createdAt: Date;
}

/**
 * List order: pinned first, then most recently active.
 *
 * A thread with no messages falls back to its creation time rather than sorting
 * last. SQL's NULLS LAST would bury a chat the student created two seconds ago
 * at the bottom of the list — the opposite of what tapping ＋ should feel like.
 * That is why ordering happens here and not in the ORDER BY.
 */
export function sortThreads<T extends SortableThread>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return recencyOf(b) - recencyOf(a);
  });
}

function recencyOf(t: SortableThread): number {
  return (t.lastMessageAt ?? t.createdAt).getTime();
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npm test -- chat-threads
```

Expected: PASS, 22 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-threads.ts src/__tests__/chat-threads.test.ts
git commit -m "feat(chat): fallbackTitle + sortThreads

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `sanitizeThreadPatch` and `resolveThreadRequest`

`PATCH /api/threads/:id` accepts four independent fields and must never let an
unknown key through to the UPDATE. `resolveThreadRequest` is the compatibility
shim's brain: given a request body that may carry `threadId` (new app),
`thesisId` (old app), or neither, decide what to do — as a pure function, so the
shim's behaviour is pinned by tests rather than by reading the route.

**Files:**
- Modify: `src/lib/chat-threads.ts`
- Test: `src/__tests__/chat-threads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/chat-threads.test.ts`:

```ts
import { sanitizeThreadPatch, resolveThreadRequest } from "../lib/chat-threads";

describe("sanitizeThreadPatch", () => {
  const NOW = new Date("2026-08-09T12:00:00Z");
  const UUID = "11111111-2222-3333-4444-555555555555";

  it("accepts a trimmed title", () => {
    expect(sanitizeThreadPatch({ title: "  Plan du chapitre 2  " }, NOW)).toEqual({ title: "Plan du chapitre 2" });
  });

  it("treats an empty title as a reset to auto-titling, not as the string ''", () => {
    expect(sanitizeThreadPatch({ title: "   " }, NOW)).toEqual({ title: null });
  });

  it("caps an absurdly long title instead of rejecting the request", () => {
    const out = sanitizeThreadPatch({ title: "x".repeat(500) }, NOW);
    expect(out?.title).toHaveLength(200);
  });

  it("maps archived:true to a timestamp and archived:false to null", () => {
    expect(sanitizeThreadPatch({ archived: true }, NOW)).toEqual({ archivedAt: NOW });
    expect(sanitizeThreadPatch({ archived: false }, NOW)).toEqual({ archivedAt: null });
  });

  it("accepts pinned", () => {
    expect(sanitizeThreadPatch({ pinned: true }, NOW)).toEqual({ pinned: true });
  });

  it("accepts a uuid thesisId, and null to detach", () => {
    expect(sanitizeThreadPatch({ thesisId: UUID }, NOW)).toEqual({ thesisId: UUID });
    expect(sanitizeThreadPatch({ thesisId: null }, NOW)).toEqual({ thesisId: null });
  });

  it("REJECTS a thesisId that is not a uuid rather than passing it to the query", () => {
    expect(sanitizeThreadPatch({ thesisId: "not-a-uuid" }, NOW)).toBeNull();
  });

  it("ignores unknown keys entirely", () => {
    expect(sanitizeThreadPatch({ userId: "someone-else", title: "ok" }, NOW)).toEqual({ title: "ok" });
  });

  it("returns null when nothing usable was sent, so the route can 400", () => {
    expect(sanitizeThreadPatch({}, NOW)).toBeNull();
    expect(sanitizeThreadPatch({ pinned: "yes" }, NOW)).toBeNull();
    expect(sanitizeThreadPatch(null, NOW)).toBeNull();
  });
});

describe("resolveThreadRequest", () => {
  const THREAD = "11111111-2222-3333-4444-555555555555";
  const THESIS = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("uses threadId when the client sent one", () => {
    expect(resolveThreadRequest({ threadId: THREAD, thesisId: THESIS })).toEqual({ kind: "thread", threadId: THREAD });
  });

  it("falls back to the newest thread for a thesis — the old-app path", () => {
    expect(resolveThreadRequest({ thesisId: THESIS })).toEqual({ kind: "newestForThesis", thesisId: THESIS });
  });

  it("is invalid when the client sent neither", () => {
    expect(resolveThreadRequest({})).toEqual({ kind: "invalid" });
  });

  it("is invalid when the ids are not uuids", () => {
    expect(resolveThreadRequest({ threadId: "nope" })).toEqual({ kind: "invalid" });
    expect(resolveThreadRequest({ thesisId: 42 })).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npm test -- chat-threads
```

Expected: FAIL — `sanitizeThreadPatch is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/chat-threads.ts`:

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Longest title we store. Long enough for any real title, short enough that a
 *  pasted essay can't become one. */
const TITLE_MAX = 200;

export interface ThreadPatch {
  title?: string | null;
  pinned?: boolean;
  archivedAt?: Date | null;
  thesisId?: string | null;
}

/**
 * Whitelist a PATCH body into the columns it is allowed to touch. Returns null
 * when nothing usable came through — including when a field was sent but was
 * the wrong type, so a typo'd client gets a 400 instead of a silent no-op.
 *
 * `now` is a parameter rather than Date.now() so the mapping is testable.
 */
export function sanitizeThreadPatch(raw: unknown, now: Date): ThreadPatch | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const patch: ThreadPatch = {};

  if ("title" in body) {
    if (typeof body.title !== "string" && body.title !== null) return null;
    const trimmed = typeof body.title === "string" ? body.title.trim() : "";
    // "" means "forget the custom title and let auto-titling own it again".
    patch.title = trimmed ? trimmed.slice(0, TITLE_MAX) : null;
  }

  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") return null;
    patch.pinned = body.pinned;
  }

  if ("archived" in body) {
    if (typeof body.archived !== "boolean") return null;
    patch.archivedAt = body.archived ? now : null;
  }

  if ("thesisId" in body) {
    if (body.thesisId !== null && !isUuid(body.thesisId)) return null;
    patch.thesisId = body.thesisId as string | null;
  }

  return Object.keys(patch).length ? patch : null;
}

/**
 * Which conversation a turn belongs to.
 *
 * `newestForThesis` is the compatibility shim: an installed APK that predates
 * threads sends only a thesisId, and gets the newest non-archived thread for it
 * (created on demand if there is none). Kept pure so the shim's rules are pinned
 * by tests rather than buried in a handler — it is the piece most likely to be
 * deleted by accident once plan 4 comes around.
 */
export type ThreadResolution =
  | { kind: "thread"; threadId: string }
  | { kind: "newestForThesis"; thesisId: string }
  | { kind: "invalid" };

export function resolveThreadRequest(body: { threadId?: unknown; thesisId?: unknown }): ThreadResolution {
  if (isUuid(body.threadId)) return { kind: "thread", threadId: body.threadId };
  if (isUuid(body.thesisId)) return { kind: "newestForThesis", thesisId: body.thesisId };
  return { kind: "invalid" };
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npm test -- chat-threads
```

Expected: PASS, 35 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-threads.ts src/__tests__/chat-threads.test.ts
git commit -m "feat(chat): thread patch validation + compat-shim resolution

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Search query folding and snippets

The query has to be folded by the same rules as `search_text` or Arabic never
matches. A result row needs a snippet showing *where* the hit was, which is what
makes a search result list useful rather than a list of titles.

**Files:**
- Modify: `src/lib/chat-threads.ts`
- Test: `src/__tests__/chat-threads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/__tests__/chat-threads.test.ts`:

```ts
import { foldSearchQuery, searchSnippet } from "../lib/chat-threads";

describe("foldSearchQuery", () => {
  it("folds the query by the same rules as the index", () => {
    expect(foldSearchQuery("  APA  ")).toBe("apa");
    expect(foldSearchQuery("خُطَّة")).toBe(buildSearchText("خطة"));
  });

  it("rejects a query too short to be worth a table scan", () => {
    expect(foldSearchQuery("a")).toBeNull();
    expect(foldSearchQuery("   ")).toBeNull();
  });

  it("rejects a non-string", () => {
    expect(foldSearchQuery(undefined)).toBeNull();
    expect(foldSearchQuery(7)).toBeNull();
  });
});

describe("searchSnippet", () => {
  it("centres the snippet on the match", () => {
    const text = "a".repeat(100) + " citer une source apa correctement " + "b".repeat(100);
    const out = searchSnippet(text, "apa", 20);
    expect(out).toContain("apa");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis when the whole text already fits", () => {
    expect(searchSnippet("citer une source apa", "apa", 40)).toBe("citer une source apa");
  });

  it("falls back to the head of the text when the term is not present", () => {
    // Postgres FTS matched on a stem we cannot reproduce in JS — still show something.
    const out = searchSnippet("une longue reponse sans le terme", "absent", 10);
    expect(out.startsWith("une longue")).toBe(true);
  });

  it("returns an empty string for empty text", () => {
    expect(searchSnippet("", "apa", 10)).toBe("");
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npm test -- chat-threads
```

Expected: FAIL — `foldSearchQuery is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/chat-threads.ts`:

```ts
/** Below this, a query matches so much that scanning is a waste. */
const MIN_QUERY_CHARS = 2;

/**
 * Fold a raw search box string by exactly the rules buildSearchText uses on the
 * stored side. If these two ever diverge, Arabic search silently stops working —
 * which is why they share foldText rather than each doing their own thing.
 * Returns null when the query isn't worth running.
 */
export function foldSearchQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const folded = foldText(q).replace(/\s+/g, " ").trim();
  return folded.length >= MIN_QUERY_CHARS ? folded : null;
}

/**
 * A window of `searchText` centred on the first occurrence of `folded`, with
 * ellipses marking either side when text was cut.
 *
 * When the term isn't found literally we still return the head of the text:
 * Postgres matched on a stem this function can't reproduce, and showing the
 * start of the message beats showing nothing.
 */
export function searchSnippet(searchText: string, folded: string, radius = 80): string {
  if (!searchText) return "";
  const at = searchText.indexOf(folded);
  if (at === -1) {
    return searchText.length <= radius * 2 ? searchText : searchText.slice(0, radius * 2).trimEnd() + "…";
  }
  const start = Math.max(0, at - radius);
  const end = Math.min(searchText.length, at + folded.length + radius);
  const body = searchText.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < searchText.length ? "…" : ""}`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
npm test -- chat-threads
```

Expected: PASS, 42 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat-threads.ts src/__tests__/chat-threads.test.ts
git commit -m "feat(chat): search query folding + snippet extraction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4b: Post-review hardening of the pure layer

Code review of Tasks 2–4 found three real defects, each reproduced with concrete
input. Apply all five changes below to `src/lib/chat-threads.ts`, keeping the
existing 42 tests byte-identical.

**1. Truncation split emoji, producing invalid UTF-8.** `fallbackTitle` and
`sanitizeThreadPatch`'s title cap both sliced on UTF-16 code units, so a cut
inside a surrogate pair left a lone high surrogate — U+FFFD on any UTF-8 encode,
and `encodeURIComponent` throws outright. Titles are auto-derived from arbitrary
student messages, so this is a volume question, not an exotic one.

```ts
/**
 * Truncate to `max` CODE POINTS. Array.from iterates code points, so an emoji
 * counts as one and can never be cut in half. A lone surrogate is not valid
 * UTF-8 — it becomes U+FFFD as soon as it reaches Postgres or a JSON response
 * body, and makes encodeURIComponent throw outright.
 */
function truncateCodePoints(s: string, max: number): string {
  const cps = Array.from(s);
  return cps.length <= max ? s : cps.slice(0, max).join("");
}
```

`fallbackTitle`'s tail becomes:

```ts
  const cps = Array.from(prose);
  if (cps.length <= FALLBACK_TITLE_MAX) return prose;
  return truncateCodePoints(prose, FALLBACK_TITLE_MAX - 1).trimEnd() + "…";
```

and `sanitizeThreadPatch` uses `truncateCodePoints(trimmed, TITLE_MAX)`.

**2. One invalid Date scrambled the whole list.** `recencyOf` returned `NaN`,
violating the sort contract — observed leaving two *unrelated valid* rows in the
wrong order, not merely misplacing the bad one.

```ts
function recencyOf(t: SortableThread): number {
  const at = (t.lastMessageAt ?? t.createdAt)?.getTime();
  // An invalid date must not poison the comparator: NaN makes the whole sort
  // undefined, and it was observed reordering two perfectly good rows. Sinking
  // the bad row is wrong-but-deterministic, which is strictly better.
  return Number.isFinite(at) ? (at as number) : -Infinity;
}
```

**3. A malformed `threadId` silently reattached the turn.** Any non-UUID
`threadId` fell through to the `thesisId` branch — indistinguishable from a
pre-threads client. Since Task 12 wires this into `/send` and `/stream`, and
`newestForThesis` *creates a thread on demand*, a client bug would have landed
the message in a conversation the student wasn't looking at, invisibly.

```ts
export function resolveThreadRequest(body: { threadId?: unknown; thesisId?: unknown }): ThreadResolution {
  if (isUuid(body.threadId)) return { kind: "thread", threadId: body.threadId };
  // A threadId that was SENT but is malformed is a client bug, not an old
  // client. Falling through to newestForThesis would hand the turn to a
  // different conversation — and create one on demand — so the fault would
  // never surface. Absent (or explicitly null) is the only "pre-threads app"
  // signal we honour.
  if (body.threadId !== undefined && body.threadId !== null) return { kind: "invalid" };
  if (isUuid(body.thesisId)) return { kind: "newestForThesis", thesisId: body.thesisId };
  return { kind: "invalid" };
}
```

**4. The query-length floor was measured after folding.** "بِ" is two keystrokes
but folds to one character, so it was rejected as "too short".

```ts
export function foldSearchQuery(q: unknown): string | null {
  if (typeof q !== "string") return null;
  const folded = foldText(q).replace(/\s+/g, " ").trim();
  if (!folded) return null;
  // Measure the floor against what the STUDENT typed, not what folding left
  // behind: Arabic tashkeel can halve the length of a perfectly ordinary word.
  return Array.from(q.trim()).length >= MIN_QUERY_CHARS ? folded : null;
}
```

**5. Snippets cut words in half.** Both edges now snap to a word boundary,
never past the match, sharing a `snapToWord` helper with the not-found path.

```ts
export function searchSnippet(searchText: string, folded: string, radius = 80): string {
  if (!searchText) return "";
  const at = folded ? searchText.indexOf(folded) : -1;
  if (at === -1) {
    if (searchText.length <= radius * 2) return searchText;
    return snapToWord(searchText, radius * 2) + "…";
  }
  let start = Math.max(0, at - radius);
  let end = Math.min(searchText.length, at + folded.length + radius);
  // Don't hand the UI half a word at either edge — but never clip the match.
  if (start > 0) {
    const sp = searchText.indexOf(" ", start);
    if (sp !== -1 && sp < at) start = sp + 1;
  }
  if (end < searchText.length) {
    const sp = searchText.lastIndexOf(" ", end);
    if (sp > at + folded.length) end = sp;
  }
  const body = searchText.slice(start, end).trim();
  return `${start > 0 ? "…" : ""}${body}${end < searchText.length ? "…" : ""}`;
}

/** Head of `s` up to `max`, backed off to the last word boundary when that
 *  doesn't throw away more than half the window. */
function snapToWord(s: string, max: number): string {
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).trimEnd();
}
```

Add five tests — one per defect — to the matching `describe` blocks:

```ts
  it("does not split an emoji when truncating — a lone surrogate is not valid UTF-8", () => {
    const out = fallbackTitle("a".repeat(58) + "😀" + "b".repeat(20));
    expect(Buffer.from(out, "utf8").toString("utf8")).toBe(out);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });

  it("caps a title at 200 code points without splitting an emoji", () => {
    const out = sanitizeThreadPatch({ title: "x".repeat(199) + "😀" + "y".repeat(50) }, new Date());
    expect(Buffer.from(out!.title!, "utf8").toString("utf8")).toBe(out!.title);
  });

  it("keeps ordering deterministic when a date is invalid", () => {
    const rows = [
      { id: "valid-old", pinned: false, lastMessageAt: new Date("2026-08-01T10:00:00Z"), createdAt: new Date("2026-08-01T09:00:00Z") },
      { id: "bad", pinned: false, lastMessageAt: new Date("nonsense"), createdAt: new Date("2026-08-05T09:00:00Z") },
      { id: "valid-newer", pinned: false, lastMessageAt: new Date("2026-08-09T10:00:00Z"), createdAt: new Date("2026-08-09T09:00:00Z") },
    ];
    // The two GOOD rows must still be ordered correctly relative to each other.
    const ids = sortThreads(rows).map((r) => r.id);
    expect(ids.indexOf("valid-newer")).toBeLessThan(ids.indexOf("valid-old"));
    expect(ids[ids.length - 1]).toBe("bad");
  });

  it("REJECTS a malformed threadId instead of silently falling back to the thesis", () => {
    expect(resolveThreadRequest({ threadId: "not-a-uuid", thesisId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }))
      .toEqual({ kind: "invalid" });
  });

  it("accepts a two-character Arabic query that folds down to one", () => {
    expect(foldSearchQuery("بِ")).toBe("ب");
  });
```

- [ ] **Verify and commit**

`npm test -- chat-threads` → 47 passing. `npm test` → 955 / 84 files.
`npx tsc --noEmit` → exit 0. And the purity check must still hold:

```bash
env -i PATH="$PATH" HOME="$HOME" npx tsx -e 'import("./src/lib/chat-threads.ts").then(()=>console.log("OK"))'
```

---

## Task 5: Schema — `chat_threads` and the `chat_messages` columns

**Files:**
- Modify: `src/db/schema.ts:171-177` (the `chatMessages` table) and its import line 1

- [ ] **Step 1: Add `index` to the pg-core import**

`src/db/schema.ts` line 1 — add `index` to the existing named imports:

```ts
import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Replace the `chatMessages` block**

Replace `src/db/schema.ts:171-177` in full with:

```ts
// A conversation. Owned by the STUDENT, not by a thesis: a thread may be
// attached to one (unlocking doc tools and RAG) or stand alone as a plain
// assistant chat.
export const chatThreads = pgTable("chat_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  // NULL = unattached. Cascades on purpose: deleting a thesis has always deleted
  // its chat, and a student who deletes a thesis does not expect its
  // conversations to survive it.
  thesisId: uuid("thesis_id").references(() => theses.id, { onDelete: "cascade" }),
  // NULL until the auto-titler runs after the first assistant turn. Titling is
  // allowed to fail — the UI falls back to the first user message.
  title: text("title"),
  pinned: boolean("pinned").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // Ordering and date-grouping key. Deliberately NOT a message COUNT: regenerate
  // DELETES chat rows, so a positional count stops describing the conversation
  // the moment it runs. chat_summaries already paid for that lesson once — its
  // message_count had to be replaced by a last_message_at cursor for exactly
  // this reason. Do not add a count here.
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Plain ascending indexes: Postgres scans a btree backwards just as cheaply,
  // and the list's real ordering happens in sortThreads() anyway.
  index("idx_chat_threads_user_recent").on(t.userId, t.lastMessageAt),
  index("idx_chat_threads_thesis_recent").on(t.thesisId, t.lastMessageAt),
]);

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  // The conversation this message belongs to. Nullable only until
  // scripts/backfill-chat-threads.ts has run; every write from this release
  // forward sets it.
  threadId: uuid("thread_id").references(() => chatThreads.id, { onDelete: "cascade" }),
  // DEPRECATED — kept so the compatibility shim and any straggler query keep
  // working while pre-threads app builds are still installed. Nothing new reads
  // it. Dropped in plan 4, one release after the shim.
  thesisId: uuid("thesis_id").references(() => theses.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  // `content` with every control frame removed and diacritics folded — see
  // buildSearchText. Search cannot read `content` directly: the image and file
  // frames it carries are useless in an index and enormous in one.
  searchText: text("search_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (t) => [
  index("idx_chat_messages_thread_created").on(t.threadId, t.createdAt),
]);
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors from `src/db/schema.ts`. Errors elsewhere about
`chatMessages.thesisId` possibly being null are expected and get fixed in Task 12
— note them and move on.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): chat_threads table; chat_messages gains thread_id + search_text

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Schema — `chat_summaries` keys off a thread

**Files:**
- Modify: `src/db/norm-profiles.ts:45-60` (the `chatSummaries` table)

- [ ] **Step 1: Rewrite the `chatSummaries` table**

Replace the `chatSummaries` definition in `src/db/norm-profiles.ts` with:

```ts
export const chatSummaries = pgTable("chat_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The conversation this summary covers. One summary per thread. */
  threadId: uuid("thread_id").unique(),
  /** DEPRECATED — legacy rows written before threads existed, relocated onto a
   *  thread by scripts/backfill-chat-threads.ts. No longer unique, no longer
   *  required, and nothing new writes it. */
  thesisId: uuid("thesis_id"),
  summary: text("summary").notNull().default(""),
  /** Kept for observability + legacy rows. NOT the slicing key — see lastMessageAt. */
  messageCount: integer("message_count").notNull().default(0),
  /**
   * createdAt of the last message folded into `summary`; everything after it is
   * the live tail. A COUNT can't be the cursor here because regenerate DELETES
   * chat rows, which makes a positional offset skip past the summary's coverage
   * into messages nothing ever summarized. Null on rows written before this
   * column existed (the legacy count path handles those).
   */
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
```

Note the FK to `chat_threads` is intentionally **not** declared here:
`norm-profiles.ts` does not import `schema.ts`, and adding that import creates a
cycle. The `ON DELETE CASCADE` is added by hand in the migration SQL in Task 7.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: errors in `src/lib/chat-memory.ts` about `chatSummaries.thesisId` — expected, fixed in Task 13.

- [ ] **Step 3: Commit**

```bash
git add src/db/norm-profiles.ts
git commit -m "feat(db): chat_summaries keys off thread_id

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Hand-write the migration and apply it

⚠️ **Do not use `drizzle-kit` on this database.** This was tried and the output
was unusable. `drizzle-kit generate` diffs against `drizzle/meta`, and that
snapshot is a long way behind reality: `ai_turn_trace`, `ai_turn_outcome`,
`ai_missing_tool_log` and `divider_templates` were all created by `ensureSchema`'s
raw SQL, never by a migration. So `generate` emits `CREATE TABLE` for four tables
that already exist, plus `ADD COLUMN` for `profiles.staff_role` and
`pending_tool_actions.turn_id` which also already exist. It fails on the first
statement. `push` is worse — it would try to reconcile the entire drift.

⚠️ **`ensureSchema` is dead on prod, and this is why.** `templates` has 16 live
columns but sits at **attnum 1600/1600** — Postgres's hard per-table ceiling,
which counts dropped columns. One more `ADD COLUMN` there breaks the boot path
again. Verify before touching anything:

```sql
SELECT count(*) FILTER (WHERE NOT attisdropped) AS live, max(attnum)
FROM pg_attribute WHERE attrelid = 'templates'::regclass AND attnum > 0;
```

- [ ] **Step 1: Introspect the live database first**

Never guess a constraint name. Confirm what is actually there:

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public'
   AND table_name IN ('chat_threads','ai_turn_trace','divider_templates');
SELECT conname FROM pg_constraint WHERE conrelid='chat_summaries'::regclass;
SELECT column_name FROM information_schema.columns WHERE table_name='chat_messages';
```

- [ ] **Step 2: Write `sql/2026-08-09-chat-threads.sql`**

Hand-written, chat-threads only, wrapped in `BEGIN`/`COMMIT` so it is
all-or-nothing. Every statement guarded (`IF NOT EXISTS`, or a `DO $$` block
checking `pg_constraint`) so a re-run is a no-op. Constraint and index names
follow drizzle's own convention (`chat_messages_thread_id_chat_threads_id_fk`,
`chat_summaries_thread_id_unique`) so a future `generate` reads them as present
rather than as more drift.

The file is committed in the repo — read it there rather than reproducing it
here. It creates `chat_threads` with its two indexes, adds `thread_id` and
`search_text` to `chat_messages` and drops that table's `thesis_id` NOT NULL,
adds the thread FK and the `(thread_id, created_at)` index, creates the GIN
index over `to_tsvector('simple', coalesce(search_text,''))`, and moves
`chat_summaries` onto `thread_id` with a UNIQUE and a cascading FK.

- [ ] **Step 3: Apply it**

```bash
node -e "
require('dotenv').config();
const fs=require('fs'), pg=require('pg');
const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
(async()=>{ await c.connect();
  try{ await c.query(fs.readFileSync('sql/2026-08-09-chat-threads.sql','utf8')); console.log('APPLIED OK'); }
  catch(e){ console.log('FAILED:', e.message); process.exitCode=1; }
  await c.end(); })();
"
```

This is safe to run against production **before** the new server code ships: it
is purely additive — one new table, two nullable columns, three constraint
relaxations — and the currently deployed code neither reads nor writes any of it.

- [ ] **Step 4: Verify what actually landed**

Confirm `chat_threads` has all nine columns; `chat_messages` has `thread_id` and
`search_text` with `thesis_id` now nullable; `chat_summaries` carries
`chat_summaries_thread_id_unique` and `chat_summaries_thread_id_fk` and no longer
`chat_summaries_thesis_id_unique`; `idx_chat_messages_search` exists; **`templates`
max attnum is still 1600**; and the message count is unchanged.

- [ ] **Step 5: Commit**

```bash
git add sql/2026-08-09-chat-threads.sql
git commit -m "feat(db): hand-written chat-threads migration, applied"
```

Leave `drizzle/meta` alone. The snapshot stays stale by choice — reconciling it
would mean teaching drizzle about years of `ensureSchema` drift, which is a
separate job and not one to do underneath a feature branch.

---

## Task 8: The database layer

Every function here takes `userId` and filters on it. That is the fix for the
first of the two live bugs: today's `GET /api/chat/:thesisId` queries on
`thesis_id` alone, so any authenticated student holding another's thesis uuid can
read their chat.

**Files:**
- Create: `src/lib/chat-threads-db.ts`

- [ ] **Step 1: Write the file**

Create `src/lib/chat-threads-db.ts`:

```ts
// Every query that touches chat_threads. The rule this file exists to enforce:
// a thread is only ever reachable through its OWNER's id. The pre-threads
// endpoints filtered on thesis_id alone, which meant any authenticated student
// holding someone else's thesis uuid could read or wipe their chat.
import { db, chatMessages, chatThreads, chatSummaries, theses } from "../db";
import { and, eq, desc, asc, gt, lt, isNull, sql } from "drizzle-orm";
import { sortThreads, type ThreadPatch } from "./chat-threads";

export type ThreadRow = typeof chatThreads.$inferSelect;

/** Create a thread. `thesisId` is verified to belong to the caller first — an
 *  unchecked insert would let a student attach their chat to a stranger's doc. */
export async function createThread(userId: string, thesisId?: string | null): Promise<ThreadRow> {
  if (thesisId) await assertThesisOwned(userId, thesisId);
  const [row] = await db.insert(chatThreads).values({ userId, thesisId: thesisId ?? null }).returning();
  return row;
}

/** One thread, or null if it does not exist OR is not this user's. The two cases
 *  are deliberately indistinguishable to the caller: telling them apart leaks
 *  which thread ids exist. */
export async function getThread(userId: string, threadId: string): Promise<ThreadRow | null> {
  const [row] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)));
  return row ?? null;
}

export async function listThreads(
  userId: string,
  opts: { thesisId?: string; archived?: boolean } = {},
): Promise<ThreadRow[]> {
  const filters = [eq(chatThreads.userId, userId)];
  if (opts.thesisId) filters.push(eq(chatThreads.thesisId, opts.thesisId));
  filters.push(opts.archived ? sql`${chatThreads.archivedAt} IS NOT NULL` : isNull(chatThreads.archivedAt));
  const rows = await db.select().from(chatThreads).where(and(...filters));
  // Ordering lives in sortThreads so an empty thread ranks by createdAt rather
  // than sorting last — see the comment there.
  return sortThreads(rows);
}

export async function patchThread(userId: string, threadId: string, patch: ThreadPatch): Promise<ThreadRow | null> {
  if (patch.thesisId) await assertThesisOwned(userId, patch.thesisId);
  const [row] = await db
    .update(chatThreads)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)))
    .returning();
  return row ?? null;
}

/** Delete a thread. Messages and the summary go with it via ON DELETE CASCADE. */
export async function deleteThread(userId: string, threadId: string): Promise<boolean> {
  const rows = await db
    .delete(chatThreads)
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, userId)))
    .returning({ id: chatThreads.id });
  return rows.length > 0;
}

/** The compatibility shim's other half: the newest non-archived thread for a
 *  thesis, created on demand. Used only by requests that arrive with a thesisId
 *  and no threadId — i.e. app builds that predate threads. */
export async function newestThreadForThesis(userId: string, thesisId: string): Promise<ThreadRow> {
  await assertThesisOwned(userId, thesisId);
  const [existing] = await db
    .select()
    .from(chatThreads)
    .where(and(eq(chatThreads.userId, userId), eq(chatThreads.thesisId, thesisId), isNull(chatThreads.archivedAt)))
    .orderBy(desc(chatThreads.lastMessageAt), desc(chatThreads.createdAt))
    .limit(1);
  if (existing) return existing;
  const [created] = await db.insert(chatThreads).values({ userId, thesisId }).returning();
  return created;
}

/** Stamp a thread as active. Called after every message insert so the list order
 *  and the date grouping stay honest. */
export async function touchThread(threadId: string, at: Date = new Date()): Promise<void> {
  await db.update(chatThreads).set({ lastMessageAt: at, updatedAt: at }).where(eq(chatThreads.id, threadId));
}

export type MessageRow = typeof chatMessages.$inferSelect;

/** History for one thread. Same three modes the thesis-keyed endpoint had:
 *  delta sync (`since`), a page (`limit`/`before`), or the lot. */
export async function threadMessages(
  threadId: string,
  opts: { since?: Date | null; before?: Date | null; limit?: number | null } = {},
): Promise<MessageRow[]> {
  if (opts.since) {
    return db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.threadId, threadId), gt(chatMessages.createdAt, opts.since)))
      .orderBy(asc(chatMessages.createdAt));
  }
  if (opts.limit) {
    const where = opts.before
      ? and(eq(chatMessages.threadId, threadId), lt(chatMessages.createdAt, opts.before))
      : eq(chatMessages.threadId, threadId);
    const rows = await db
      .select()
      .from(chatMessages)
      .where(where)
      .orderBy(desc(chatMessages.createdAt))
      .limit(opts.limit);
    return rows.reverse();
  }
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(asc(chatMessages.createdAt));
}

export interface ThreadSearchHit {
  thread: ThreadRow;
  messageId: string;
  searchText: string;
  createdAt: Date | null;
}

/** Cross-thread message search, scoped to the caller. Titles are matched by the
 *  route (a plain ILIKE over a small set); this is the message-body half. */
export async function searchThreadMessages(userId: string, folded: string, limit = 30): Promise<ThreadSearchHit[]> {
  const rows = await db
    .select({ thread: chatThreads, messageId: chatMessages.id, searchText: chatMessages.searchText, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreads.userId, userId),
        sql`to_tsvector('simple', coalesce(${chatMessages.searchText}, '')) @@ plainto_tsquery('simple', ${folded})`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.map((r) => ({ thread: r.thread, messageId: r.messageId, searchText: r.searchText ?? "", createdAt: r.createdAt }));
}

/** Throws if the thesis isn't the caller's. Callers turn this into a 404. */
async function assertThesisOwned(userId: string, thesisId: string): Promise<void> {
  const [row] = await db.select({ id: theses.id }).from(theses).where(and(eq(theses.id, thesisId), eq(theses.userId, userId)));
  if (!row) throw new ThreadAccessError("thesis not found");
}

export class ThreadAccessError extends Error {}

/** Used by the thread delete path and by the shim's "clear chat". Removes the
 *  summary explicitly rather than relying on the cascade, so the same helper
 *  works for clearing a thread the student is keeping. */
export async function clearThreadMessages(threadId: string): Promise<void> {
  await db.delete(chatMessages).where(eq(chatMessages.threadId, threadId));
  await db.delete(chatSummaries).where(eq(chatSummaries.threadId, threadId));
  await db.update(chatThreads).set({ lastMessageAt: null, updatedAt: new Date() }).where(eq(chatThreads.id, threadId));
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors originating in `src/lib/chat-threads-db.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat-threads-db.ts
git commit -m "feat(chat): thread db layer, ownership-scoped by construction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: The `/api/threads` routes

**Files:**
- Create: `src/routes/chat-threads.ts`
- Modify: `src/index.ts:107` (mount alongside the other routes)

- [ ] **Step 1: Write the route file**

Create `src/routes/chat-threads.ts`:

```ts
import { Hono } from "hono";
import type { AppVariables } from "../types";
import {
  createThread, getThread, listThreads, patchThread, deleteThread,
  threadMessages, searchThreadMessages, ThreadAccessError,
} from "../lib/chat-threads-db";
import { sanitizeThreadPatch, foldSearchQuery, searchSnippet } from "../lib/chat-threads";

export const chatThreadRoutes = new Hono<{ Variables: AppVariables }>();

// Date grouping (Today / Last 7 days / Older) is deliberately NOT computed here.
// The server's timezone is not the student's, and a thread that was "today" in
// Casablanca must not read as yesterday because the box runs UTC. The client
// groups from last_message_at.

const parseDate = (raw?: string) => {
  const d = raw ? new Date(raw) : null;
  return d && !isNaN(d.getTime()) ? d : null;
};

chatThreadRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const thesisId = c.req.query("thesisId") || undefined;
  const archived = c.req.query("archived") === "1";
  return c.json(await listThreads(userId, { thesisId, archived }));
});

chatThreadRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const thesisId = typeof body?.thesisId === "string" ? body.thesisId : null;
  try {
    return c.json(await createThread(userId, thesisId));
  } catch (e) {
    if (e instanceof ThreadAccessError) return c.json({ error: "Thesis not found" }, 404);
    throw e;
  }
});

// Registered BEFORE /:id so "search" is never parsed as a thread id.
chatThreadRoutes.get("/search", async (c) => {
  const userId = c.get("userId");
  const folded = foldSearchQuery(c.req.query("q"));
  if (!folded) return c.json([]);
  const hits = await searchThreadMessages(userId, folded);
  // One row per thread — the best (most recent) hit wins. A student searching
  // "APA" wants the conversations, not forty copies of the same one.
  const seen = new Set<string>();
  const out = [];
  for (const h of hits) {
    if (seen.has(h.thread.id)) continue;
    seen.add(h.thread.id);
    out.push({ thread: h.thread, messageId: h.messageId, snippet: searchSnippet(h.searchText, folded), createdAt: h.createdAt });
  }
  return c.json(out);
});

chatThreadRoutes.get("/:id/messages", async (c) => {
  const userId = c.get("userId");
  const thread = await getThread(userId, c.req.param("id"));
  if (!thread) return c.json({ error: "Not found" }, 404);
  const limitRaw = c.req.query("limit");
  // Clamp so a bad client can't ask for an unbounded page.
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 0, 1), 200) : null;
  return c.json(await threadMessages(thread.id, {
    since: parseDate(c.req.query("since")),
    before: parseDate(c.req.query("before")),
    limit,
  }));
});

chatThreadRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const patch = sanitizeThreadPatch(await c.req.json().catch(() => null), new Date());
  if (!patch) return c.json({ error: "Nothing to update" }, 400);
  try {
    const row = await patchThread(userId, c.req.param("id"), patch);
    return row ? c.json(row) : c.json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof ThreadAccessError) return c.json({ error: "Thesis not found" }, 404);
    throw e;
  }
});

chatThreadRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const ok = await deleteThread(userId, c.req.param("id"));
  return ok ? c.json({ success: true }) : c.json({ error: "Not found" }, 404);
});
```

- [ ] **Step 2: Mount it**

In `src/index.ts`, add the import next to the other route imports at the top:

```ts
import { chatThreadRoutes } from "./routes/chat-threads";
```

and the mount immediately after the existing `app.route("/api/chat", chatRoutes);` on line 107:

```ts
app.route("/api/threads", chatThreadRoutes);
```

It sits below `app.use("/api/*", authMiddleware)`, so `c.get("userId")` is always populated.

- [ ] **Step 3: Typecheck and boot**

```bash
npx tsc --noEmit && npm run dev
```

Expected: compiles; the server starts and logs its port. Stop it with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add src/routes/chat-threads.ts src/index.ts
git commit -m "feat(chat): /api/threads endpoints

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Probe script — prove ownership isolation against a real database

The unit tests cover the pure logic; they cannot prove that user B is actually
locked out of user A's thread, because that lives in a WHERE clause. This repo's
established answer to that is a `scripts/probe-*.ts` script
(`probe-chat-context.ts`, `probe-missing-tool-log.ts`), so follow it.

**Files:**
- Create: `scripts/probe-chat-threads.ts`

- [ ] **Step 1: Write the probe**

Create `scripts/probe-chat-threads.ts`:

```ts
// Manual verification for the thread API against a LIVE database.
//   npx tsx scripts/probe-chat-threads.ts <userIdA> <userIdB>
// Both must be real profiles.id values. Creates a thread as A, proves B cannot
// see, patch or delete it, then cleans up after itself.
import "dotenv/config";
import { db, chatMessages } from "../src/db";
import {
  createThread, getThread, listThreads, patchThread, deleteThread,
  threadMessages, searchThreadMessages,
} from "../src/lib/chat-threads-db";
import { buildSearchText } from "../src/lib/chat-threads";

const [userA, userB] = process.argv.slice(2);
if (!userA || !userB) {
  console.error("usage: npx tsx scripts/probe-chat-threads.ts <userIdA> <userIdB>");
  process.exit(1);
}

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

async function main() {
  const thread = await createThread(userA);
  console.log(`created thread ${thread.id} for user A`);

  check("A can read their own thread", (await getThread(userA, thread.id)) !== null);
  check("B CANNOT read A's thread", (await getThread(userB, thread.id)) === null);
  check("B's list does not contain A's thread", (await listThreads(userB)).every((t) => t.id !== thread.id));
  check("B CANNOT patch A's thread", (await patchThread(userB, thread.id, { pinned: true })) === null);
  check("A can patch their own thread", (await patchThread(userA, thread.id, { title: "probe" }))?.title === "probe");

  const content = 'Comment citer une source APA ?\n[[MODK_IMG]]{"url":"https://x/y.jpg"}[[/MODK_IMG]]';
  await db.insert(chatMessages).values({
    threadId: thread.id, thesisId: null, role: "user", content, searchText: buildSearchText(content),
  });

  const msgs = await threadMessages(thread.id);
  check("the message is readable through the thread", msgs.length === 1);
  check("search_text has no image URL in it", !(msgs[0]?.searchText ?? "").includes("https://"));

  check("A finds their message by search", (await searchThreadMessages(userA, "apa")).some((h) => h.thread.id === thread.id));
  check("B finds NOTHING of A's", (await searchThreadMessages(userB, "apa")).every((h) => h.thread.id !== thread.id));

  check("B CANNOT delete A's thread", (await deleteThread(userB, thread.id)) === false);
  check("A can delete their own thread", (await deleteThread(userA, thread.id)) === true);
  check("deleting the thread cascaded its messages away", (await threadMessages(thread.id)).length === 0);

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it against the local database**

Get two real user ids:

```bash
psql "$DATABASE_URL" -c "SELECT id FROM profiles LIMIT 2;"
```

Then:

```bash
npx tsx scripts/probe-chat-threads.ts <userIdA> <userIdB>
```

Expected: every line `PASS`, ending with `ALL CHECKS PASSED`. Any `FAIL` is a
real ownership hole — fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-chat-threads.ts
git commit -m "test(chat): probe script proving thread ownership isolation

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Backfill every existing chat into a thread

**Files:**
- Modify: `src/lib/chat-threads.ts` (add `backfillThreadRow`)
- Test: `src/__tests__/chat-threads.test.ts`
- Create: `scripts/backfill-chat-threads.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/__tests__/chat-threads.test.ts`:

```ts
import { backfillThreadRow } from "../lib/chat-threads";

describe("backfillThreadRow", () => {
  const group = {
    thesisId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    userId: "11111111-2222-3333-4444-555555555555",
    thesisTitle: "Ma thèse en IA",
    firstMessageAt: new Date("2026-07-01T09:00:00Z"),
    lastMessageAt: new Date("2026-08-01T17:00:00Z"),
  };

  it("titles the thread after the thesis", () => {
    expect(backfillThreadRow(group).title).toBe("Ma thèse en IA");
  });

  it("dates the thread from its OWN messages, not from now", () => {
    // A backfilled thread must sort where the conversation actually happened.
    const row = backfillThreadRow(group);
    expect(row.createdAt).toEqual(group.firstMessageAt);
    expect(row.lastMessageAt).toEqual(group.lastMessageAt);
    expect(row.updatedAt).toEqual(group.lastMessageAt);
  });

  it("carries over the owner and the attachment", () => {
    const row = backfillThreadRow(group);
    expect(row.userId).toBe(group.userId);
    expect(row.thesisId).toBe(group.thesisId);
  });

  it("truncates an over-long thesis title to the title budget", () => {
    const row = backfillThreadRow({ ...group, thesisTitle: "x".repeat(400) });
    expect(row.title).toHaveLength(200);
  });

  it("leaves the title NULL when the thesis has none, so auto-titling picks it up", () => {
    expect(backfillThreadRow({ ...group, thesisTitle: "   " }).title).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- chat-threads
```

Expected: FAIL — `backfillThreadRow is not exported`.

- [ ] **Step 3: Implement it**

Append to `src/lib/chat-threads.ts`:

```ts
export interface BackfillGroup {
  thesisId: string;
  userId: string;
  thesisTitle: string;
  firstMessageAt: Date;
  lastMessageAt: Date;
}

export interface BackfillThreadRow {
  userId: string;
  thesisId: string;
  title: string | null;
  createdAt: Date;
  lastMessageAt: Date;
  updatedAt: Date;
}

/**
 * The thread row that stands in for one thesis's pre-threads conversation.
 *
 * Timestamps come from the MESSAGES, never from now(): a backfilled thread has
 * to sort where the conversation actually happened, or every student's history
 * collapses into "everything, today".
 */
export function backfillThreadRow(g: BackfillGroup): BackfillThreadRow {
  const title = g.thesisTitle.trim();
  return {
    userId: g.userId,
    thesisId: g.thesisId,
    title: title ? title.slice(0, TITLE_MAX) : null,
    createdAt: g.firstMessageAt,
    lastMessageAt: g.lastMessageAt,
    updatedAt: g.lastMessageAt,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -- chat-threads
```

Expected: PASS, 52 tests total.

- [ ] **Step 5: Write the backfill script**

Create `scripts/backfill-chat-threads.ts`:

```ts
// One-shot, idempotent backfill: every thesis that has chat messages gets
// exactly one thread, and its messages, summary and search text are moved onto
// it.
//
//   npx tsx scripts/backfill-chat-threads.ts --dry
//   npx tsx scripts/backfill-chat-threads.ts
//
// Idempotent by construction: it only ever considers messages where thread_id
// IS NULL, and reuses the oldest existing thread for a thesis if one is already
// there. Safe to run twice, and safe to run while the server is up — the shim
// creates threads on demand and this script adopts them.
import "dotenv/config";
import { db, chatMessages, chatThreads, chatSummaries, theses } from "../src/db";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { backfillThreadRow, buildSearchText } from "../src/lib/chat-threads";

const DRY = process.argv.includes("--dry");

async function main() {
  // Theses that still have unthreaded messages, with the window they span.
  const groups = await db
    .select({
      thesisId: chatMessages.thesisId,
      userId: theses.userId,
      thesisTitle: theses.title,
      firstMessageAt: sql<Date>`min(${chatMessages.createdAt})`,
      lastMessageAt: sql<Date>`max(${chatMessages.createdAt})`,
    })
    .from(chatMessages)
    .innerJoin(theses, eq(chatMessages.thesisId, theses.id))
    .where(isNull(chatMessages.threadId))
    .groupBy(chatMessages.thesisId, theses.userId, theses.title);

  console.log(`${groups.length} thesis/theses with unthreaded messages`);

  for (const g of groups) {
    if (!g.thesisId) continue;

    // Adopt a thread the shim may already have created for this thesis rather
    // than making a second one.
    const [existing] = await db
      .select()
      .from(chatThreads)
      .where(and(eq(chatThreads.userId, g.userId), eq(chatThreads.thesisId, g.thesisId)))
      .orderBy(asc(chatThreads.createdAt))
      .limit(1);

    const row = backfillThreadRow({
      thesisId: g.thesisId,
      userId: g.userId,
      thesisTitle: g.thesisTitle ?? "",
      firstMessageAt: new Date(g.firstMessageAt),
      lastMessageAt: new Date(g.lastMessageAt),
    });

    if (DRY) {
      console.log(`[dry] ${existing ? "adopt" : "create"} thread for thesis ${g.thesisId} — "${row.title ?? "(untitled)"}"`);
      continue;
    }

    const threadId = existing
      ? existing.id
      : (await db.insert(chatThreads).values(row).returning({ id: chatThreads.id }))[0].id;

    const moved = await db
      .update(chatMessages)
      .set({ threadId })
      .where(and(eq(chatMessages.thesisId, g.thesisId), isNull(chatMessages.threadId)))
      .returning({ id: chatMessages.id });

    // Relocate the thesis-keyed summary onto the thread. Only the rows that have
    // not been relocated already, so a second run is a no-op.
    await db
      .update(chatSummaries)
      .set({ threadId })
      .where(and(eq(chatSummaries.thesisId, g.thesisId), isNull(chatSummaries.threadId)));

    console.log(`thesis ${g.thesisId}: ${existing ? "adopted" : "created"} thread ${threadId}, moved ${moved.length} messages`);
  }

  // search_text for every message that predates the column. Batched so one
  // enormous student doesn't hold the whole set in memory.
  let done = 0;
  for (;;) {
    const batch = await db
      .select({ id: chatMessages.id, content: chatMessages.content })
      .from(chatMessages)
      .where(isNull(chatMessages.searchText))
      .limit(500);
    if (!batch.length) break;
    if (DRY) { console.log(`[dry] would index ${batch.length}+ messages`); break; }
    for (const m of batch) {
      await db.update(chatMessages).set({ searchText: buildSearchText(m.content) }).where(eq(chatMessages.id, m.id));
    }
    done += batch.length;
    console.log(`indexed ${done} messages`);
  }

  console.log("done");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Dry-run, then run, then verify**

```bash
npx tsx scripts/backfill-chat-threads.ts --dry
npx tsx scripts/backfill-chat-threads.ts
npx tsx scripts/backfill-chat-threads.ts   # second run must be a no-op
```

Expected: the third run reports `0 thesis/theses with unthreaded messages`.

Then confirm nothing was orphaned:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) AS orphans FROM chat_messages WHERE thread_id IS NULL;"
psql "$DATABASE_URL" -c "SELECT count(*) AS unindexed FROM chat_messages WHERE search_text IS NULL;"
```

Expected: both `0`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/chat-threads.ts src/__tests__/chat-threads.test.ts scripts/backfill-chat-threads.ts
git commit -m "feat(chat): idempotent backfill of existing chats into threads

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire `chat.ts` — write `thread_id`, and fix the two live bugs

**Files:**
- Modify: `src/routes/chat.ts` — six insert sites (lines 300, 334, 491, 597, 628, 782), `saveUserMessage:313`, `prepareRegeneratedTurn:255`, `GET /:thesisId:936`, `DELETE /:thesisId:981`

- [ ] **Step 1: Add the imports**

At the top of `src/routes/chat.ts`, after the existing `../db` import:

```ts
import { buildSearchText, resolveThreadRequest } from "../lib/chat-threads";
import {
  newestThreadForThesis, getThread, touchThread, threadMessages,
  clearThreadMessages, ThreadAccessError,
} from "../lib/chat-threads-db";
```

- [ ] **Step 2: Add one helper, right below `messageText` (line 94)**

```ts
// Every chat_messages insert goes through here. Two things must happen on every
// single write or the feature quietly rots: search_text has to be computed (a
// NULL one is invisible to search forever), and the thread has to be stamped as
// active (an unstamped thread sinks to the bottom of the list). Centralised
// because there are six insert sites and the seventh would forget.
async function insertChatMessage(args: {
  threadId: string;
  thesisId: string | null;
  role: "user" | "assistant";
  content: string;
}): Promise<{ id: string; createdAt: Date | null }> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      threadId: args.threadId,
      thesisId: args.thesisId,
      role: args.role,
      content: args.content,
      searchText: buildSearchText(args.content),
    })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });
  await touchThread(args.threadId, row.createdAt ?? new Date());
  return row;
}

// Resolve the conversation a turn belongs to. New app builds send threadId; the
// ones already installed send only thesisId and get the newest thread for it.
// Throws ThreadAccessError when the caller doesn't own what they asked for.
async function resolveTurnThread(
  userId: string,
  body: { threadId?: unknown; thesisId?: unknown },
): Promise<{ threadId: string; thesisId: string }> {
  const r = resolveThreadRequest(body);
  if (r.kind === "invalid") throw new ThreadAccessError("thread or thesis required");
  const t = r.kind === "newestForThesis"
    ? await newestThreadForThesis(userId, r.thesisId)
    : await getThread(userId, r.threadId);
  if (!t) throw new ThreadAccessError("thread not found");
  // Until plan 3 lands the no-thesis branch, every turn needs a document:
  // prepareTurnContext, the RAG pipeline and the whole doc-tool catalogue take a
  // thesisId and cannot be handed null. Nothing in plans 1-2 can CREATE an
  // unattached thread, so this is unreachable today — it is here so the
  // narrowed return type is honest rather than an assertion, and so the day
  // someone does create one they get a clear 400 instead of a null-deref
  // somewhere inside the tool loop.
  if (!t.thesisId) throw new ThreadAccessError("thread has no thesis attached");
  return { threadId: t.id, thesisId: t.thesisId };
}
```

- [ ] **Step 3: Convert `/stream` and `/send` to resolve a thread first**

Both handlers currently open by destructuring the parsed body. **Read the body
once** — Hono will not re-read a consumed request — so capture it in a variable,
add `threadId` to the destructure, and pass that same object to
`resolveTurnThread`.

In `chatRoutes.post("/send")` (line 498) and `chatRoutes.post("/stream")`
(line 643), change the opening from the current
`const { thesisId, message, ... } = await c.req.json();` to:

```ts
  const body = await c.req.json();
  const { message, selection, docBlockIndex, docBlockIndices, model, provider, reasoning, regenerate, attachments } = body;

  let threadId: string;
  let thesisId: string;
  try {
    ({ threadId, thesisId } = await resolveTurnThread(userId, body));
  } catch (e) {
    if (e instanceof ThreadAccessError) return c.json({ error: e.message }, 404);
    throw e;
  }
```

Note `thesisId` is no longer destructured from the body — it now comes from the
resolved thread, which is what makes the client unable to point a turn at a
document it doesn't own. Every existing reference to `thesisId` further down both
handlers keeps working unchanged; that is why this shadowing shape was chosen
over a renamed variable.

`/send` takes `provider` and the rest from the same destructure — check the exact
field list in each handler and keep it as it was, minus `thesisId`.

Then pass `threadId` (not `thesisId`) to `saveUserMessage`,
`prepareRegeneratedTurn` and `maybeSummarize`. `prepareTurnContext` keeps taking
`thesisId` — it is the document context builder, and the document is still what
it needs.

- [ ] **Step 4: Convert the six insert sites**

List them first so none is missed:

```bash
grep -n "db.insert(chatMessages)" src/routes/chat.ts
```

Expected: six hits — lines 300, 334, 491, 597, 628, 782.

Rewrite each one as a call to `insertChatMessage`, **keeping its existing `role`
and `content` arguments exactly as they are** and adding `threadId`. The two
whose shape is already known:

| Line | Was | Becomes |
| --- | --- | --- |
| 300 | `await db.insert(chatMessages).values({ thesisId, role: "user", content: message })` | `await insertChatMessage({ threadId, thesisId, role: "user", content: message })` |
| 334 | `await db.insert(chatMessages).values({ thesisId, role: "user", content })` | `await insertChatMessage({ threadId, thesisId, role: "user", content })` |

For the other four, apply the same transformation to whatever `role`/`content`
each already passes. Two need extra care:

- **Line 491** inserts inside a background/offline path using an options object
  `o` (`o.thesisId`). That object must now also carry `o.threadId` — add the
  field where the object is constructed and pass it through, then call
  `insertChatMessage({ threadId: o.threadId, thesisId: o.thesisId, role: "assistant", content: toSave })`.
- **Line 597** destructures the returned row (`const [saved] = await db.insert(...)`).
  `insertChatMessage` returns the row directly, so this becomes
  `const saved = await insertChatMessage({ ... })`. Check what `saved` is used
  for downstream — it needs `id` and `createdAt`, both of which are returned.

Then change `saveUserMessage` (line 313) and `prepareRegeneratedTurn` (line 255)
to take `threadId` as their first parameter and filter on
`eq(chatMessages.threadId, threadId)` in place of
`eq(chatMessages.thesisId, thesisId)`. `prepareRegeneratedTurn` also calls
`recordRegenerateOutcome(thesisId, {})` — leave that on `thesisId`, since the
training-capture tables key off the document.

- [ ] **Step 4b: Prove no raw insert survived**

```bash
grep -n "db.insert(chatMessages)" src/routes/chat.ts
```

Expected: **one** hit, inside `insertChatMessage` itself. Any other is a message
that will be saved without `search_text` and never appear in search.

```bash
grep -rn "db.insert(chatMessages)" src/ --include=*.ts | grep -v "chat.ts"
```

Expected: no output. If another file inserts chat messages, it needs the same
treatment.

- [ ] **Step 5: Fix bug #1 — the shim must check ownership**

Replace `chatRoutes.get("/:thesisId")` (line 936) in full:

```ts
// COMPATIBILITY SHIM. Pre-threads app builds only know this shape. It resolves
// the newest thread for the thesis and returns its messages.
//
// The old version filtered on thesis_id ALONE — authMiddleware proved *a* user,
// but not that this thesis was theirs, so any authenticated student holding
// someone else's thesis uuid could read their entire chat. newestThreadForThesis
// verifies ownership; a stranger now gets an empty list, not a transcript.
chatRoutes.get("/:thesisId", async (c) => {
  const userId = c.get("userId");
  const thesisId = c.req.param("thesisId");
  const parseDate = (raw?: string) => {
    const d = raw ? new Date(raw) : null;
    return d && !isNaN(d.getTime()) ? d : null;
  };
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 0, 1), 200) : null;

  try {
    const thread = await newestThreadForThesis(userId, thesisId);
    return c.json(await threadMessages(thread.id, {
      since: parseDate(c.req.query("since")),
      before: parseDate(c.req.query("before")),
      limit,
    }));
  } catch {
    return c.json([], 200); // Unchanged contract: this endpoint never 500s at the client.
  }
});
```

- [ ] **Step 6: Fix bug #2 — clearing a chat must clear the real summary**

Replace `chatRoutes.delete("/:thesisId")` (line 981) in full:

```ts
// COMPATIBILITY SHIM — "clear chat" from a pre-threads build.
//
// The old version reset theses.chat_summary / chat_summary_count. Those columns
// are DEAD: the live summary lives in chat_summaries, so clearing a chat left a
// stale summary behind and the next conversation opened with the deleted one
// still in its context. clearThreadMessages removes the summary row itself.
chatRoutes.delete("/:thesisId", async (c) => {
  const userId = c.get("userId");
  try {
    const thread = await newestThreadForThesis(userId, c.req.param("thesisId"));
    await clearThreadMessages(thread.id);
    return c.json({ success: true });
  } catch (e) {
    if (e instanceof ThreadAccessError) return c.json({ error: "Not found" }, 404);
    throw e;
  }
});
```

- [ ] **Step 7: Typecheck and run the suite**

```bash
npx tsc --noEmit && npm test
```

Expected: no type errors; every existing test still passes.

- [ ] **Step 8: Verify the shim end to end**

Start the server (`npm run dev`), then with a real bearer token for a user who
has an existing thesis:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/chat/$THESIS_ID?limit=5" | head -c 400
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/threads" | head -c 400
```

Expected: the first returns that thesis's recent messages exactly as before; the
second lists the thread they now belong to.

Then prove the hole is closed — with user B's token and user A's thesis id:

```bash
curl -s -H "Authorization: Bearer $TOKEN_B" "http://localhost:3000/api/chat/$THESIS_ID_OF_A"
```

Expected: `[]`.

- [ ] **Step 9: Commit**

```bash
git add src/routes/chat.ts
git commit -m "feat(chat): route turns through threads; close two chat bugs

Messages now carry thread_id and search_text on every insert.

GET/DELETE /api/chat/:thesisId filtered on thesis_id alone, so any
authenticated user with another student's thesis uuid could read or wipe
their chat. Both now resolve through an ownership-checked thread.

DELETE also reset theses.chat_summary / chat_summary_count, which are dead
columns — the live summary is in chat_summaries, so clearing a chat left a
stale summary that leaked into the next conversation.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: `chat-memory` keys off a thread

**Files:**
- Modify: `src/lib/chat-memory.ts:134` (`buildChatContext`) and `:246` (`maybeSummarize`)

- [ ] **Step 1: Change `buildChatContext`**

Change the signature to `buildChatContext(threadId: string)`, and:

- select the summary with `eq(chatSummaries.threadId, threadId)`;
- select messages with `eq(chatMessages.threadId, threadId)`;
- **delete the `theses.chatSummary` / `theses.chatSummaryCount` fallback block**
  (lines ~149-156). Those columns are dead — the backfill has relocated every
  real summary onto a thread, so the fallback can now only ever read stale text
  written before `chat_summaries` existed.

The pure helpers it calls — `legacySkip`, `tailNeedsFloor`, `trimContextTail` —
are unchanged, and so are their tests.

- [ ] **Step 2: Change `maybeSummarize`**

Change the signature to `maybeSummarize(threadId: string, provider: AIProvider, model?: string)`;
select and upsert `chatSummaries` on `threadId`; delete the same dead-column
fallback block.

- [ ] **Step 3: Update the call sites in `chat.ts`**

Lines 386, 433, 603 and 792 pass `thesisId` today. Pass the resolved `threadId`
instead. Line 433's `o.thesisId` becomes `o.threadId` — the same options object
extended in Task 12 Step 4.

- [ ] **Step 4: Typecheck and run the suite**

```bash
npx tsc --noEmit && npm test
```

Expected: clean, and `chat-memory-window.test.ts` still passes untouched — it
tests pure functions that never knew about theses.

- [ ] **Step 5: Verify context is still built correctly**

```bash
npx tsx scripts/probe-chat-context.ts <threadId>
```

Update that script's argument from a thesis id to a thread id as part of this
step. Expected: it prints the summary plus the live tail, with no gap between
what the summary covers and where the tail starts.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chat-memory.ts src/routes/chat.ts scripts/probe-chat-context.ts
git commit -m "feat(chat): chat memory + summaries key off a thread

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deployment

In this order, and only after the whole plan is green:

1. Deploy the server. The shim means installed apps notice nothing.
2. `npx tsx scripts/backfill-chat-threads.ts --dry` against **prod**, read the output.
3. `npx tsx scripts/backfill-chat-threads.ts` against prod.
4. Confirm `SELECT count(*) FROM chat_messages WHERE thread_id IS NULL` is `0`.

Note the ordering: the server ships **before** the backfill. The shim creates
threads on demand for any student who chats in the gap, and the backfill adopts
those threads rather than duplicating them, so there is no window where a
conversation lands in the wrong place.

## Done when

- `npm test` passes, including 52 new tests in `chat-threads.test.ts`.
- `npx tsc --noEmit` is clean.
- `scripts/probe-chat-threads.ts` reports `ALL CHECKS PASSED`.
- The backfill is idempotent — a second run reports zero work.
- `GET /api/chat/:thesisId` returns the same messages it did before, and returns
  `[]` for a thesis the caller doesn't own.
- No student-visible change.
