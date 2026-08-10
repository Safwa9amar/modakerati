# Chat Threads — Unattached Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student open a chat with no thesis attached — a plain assistant that knows it's a thesis app — and attach a thesis mid-conversation to unlock the document tools.

**Architecture:** `chat_threads.thesis_id` has been nullable since plan 1; nothing has ever produced a null. This plan makes that state reachable and safe. On the server, a turn with no thesis skips RAG and document context, and the model is shown only the tools that don't need a document — **derived from the tool schemas themselves**, not a hand-maintained list. On the app, ＋ New chat can create an unattached thread and the composer gains an attach control.

**Tech Stack:** Hono/Drizzle server (vitest), Expo app (no test runner — tsc + run it).

---

## Scope

**Plan 3 of 4**, covering spec slice 5. Plan 4 then drops the compatibility shim and `chat_messages.thesis_id`.

Plans 1–2 are done and live: threads, the history panel, auto-titling, search/pin/archive, and two prod migrations. Server baseline: `npm test` → 971 passed / 85 files, `npx tsc --noEmit` clean. App: tsc clean, bundles, runs.

## Conventions

- Server: `~/modakerati-server`, branch `feat/chat-threads`. App: `~/modakerati`, branch `feat/chat-threads-app`.
- Commits end with a blank line then `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `git add` exact paths, never `-A`.
- ⚠️ `DATABASE_URL` is **production**. Read-only unless a task says otherwise.
- ⚠️ `locales/{en,fr,ar}.json` have duplicate keys — edit surgically, never round-trip through a JSON parser.
- ⚠️ **`tsc` cannot catch an id mix-up** (both are strings). Rely on the greps each task specifies.

## The central design decision

"Which tools work without a document?" could be a hand-maintained deny-list. It should not be: every new doc tool would have to remember to join it, and the one that forgets leaks a crash into unattached chat.

The tools already declare what they need, in their own schemas. **A tool that
declares a thesis-scoped parameter needs a thesis.** That rule maintains itself,
and a doc tool written tomorrow is covered the day it lands.

⚠️ **`thesisId` alone is not enough** — found by dumping the real tool list.
Checking only for a declared `thesisId` still left an unattached chat holding
`delete_chapter`, `delete_section`, `update_chapter_content`, `delete_reference`
and the source readers, because those are scoped by `sectionId` / `chapterId` /
`referenceId` / `sourceId` instead. Not a security hole — the handlers verify
ownership — but it made the whole premise of this plan untrue.

So the maintained thing is a short list of **parameter names**:

```ts
export const THESIS_SCOPED_PARAMS = ["thesisId", "sectionId", "chapterId", "referenceId", "sourceId"] as const;
```

That is still schema-derived, and it is a very different maintenance burden from
a list of tool names: the catalogue grows constantly, this vocabulary barely
moves. `templateId` is deliberately excluded — templates are a shared catalogue,
not one student's document, so `get_template` and `list_templates` are useful in
a plain chat.

The nine tools that should survive in an unattached chat: `list_theses`,
`create_thesis`, `ask_user`, `ask_user_with_previews`, `notify_user`,
`list_templates`, `get_template`, `get_user_profile`, `update_user_profile`.

---

## Task 1: `isToolVisible` — extract the rule and test it (server, TDD)

Tool visibility currently lives inline in `connectMcpToolset` as
`live ? !DB_CONTENT_MUTATORS.has(name) : !LIVE_DOCX_TOOLS.has(name)`, which is
untestable without standing up an MCP server. Extract it, add the third case.

**Files:** create `src/lib/ai/tool-visibility.ts`, `src/__tests__/tool-visibility.test.ts`; modify `src/lib/ai/mcp-bridge.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { isToolVisible } from "../lib/ai/tool-visibility";

const live = { live: true, hasThesis: true };
const legacy = { live: false, hasThesis: true };
const unattached = { live: false, hasThesis: false };

describe("isToolVisible", () => {
  it("offers the block tools on a live-docx thesis and hides the db mutators", () => {
    expect(isToolVisible("edit_paragraph", { ...live, needsThesis: true })).toBe(true);
    expect(isToolVisible("update_section_content", { ...live, needsThesis: true })).toBe(false);
  });

  it("hides the block tools on a legacy thesis", () => {
    expect(isToolVisible("edit_paragraph", { ...legacy, needsThesis: true })).toBe(false);
  });

  it("hides EVERY tool that needs a thesis when none is attached", () => {
    expect(isToolVisible("edit_paragraph", { ...unattached, needsThesis: true })).toBe(false);
    expect(isToolVisible("get_thesis_outline", { ...unattached, needsThesis: true })).toBe(false);
    expect(isToolVisible("export_thesis", { ...unattached, needsThesis: true })).toBe(false);
  });

  it("keeps the tools that need no thesis when none is attached", () => {
    // ask_user is how the model asks a question — it must survive, or an
    // unattached chat cannot even ask which thesis to attach.
    expect(isToolVisible("ask_user", { ...unattached, needsThesis: false })).toBe(true);
    expect(isToolVisible("load_tools", { ...unattached, needsThesis: false })).toBe(true);
  });

  it("derives the answer from the SCHEMA, not from a name list", () => {
    // The whole point: a tool invented tomorrow that declares thesisId is
    // hidden without anyone editing this file.
    expect(isToolVisible("some_future_doc_tool", { ...unattached, needsThesis: true })).toBe(false);
    expect(isToolVisible("some_future_doc_tool", { ...legacy, needsThesis: true })).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch fail** — `npm test -- tool-visibility`

- [ ] **Step 3: Implement**

```ts
// Which tools the MODEL is allowed to see this turn. Extracted from
// connectMcpToolset so the rule is testable without standing up an MCP server.
import { DB_CONTENT_MUTATORS, LIVE_DOCX_TOOLS } from "./mcp-tool-sets";

export interface VisibilityCtx {
  /** The thesis stores its content as a live .docx. */
  live: boolean;
  /** A thesis is attached to this conversation at all. */
  hasThesis: boolean;
  /** The tool's own schema declares a thesisId parameter. */
  needsThesis: boolean;
}

/**
 * An unattached chat hides every tool that needs a document — and it works that
 * out from the tool's SCHEMA, not from a list kept by hand. A tool that declares
 * thesisId needs a thesis; one added tomorrow is covered the day it is written,
 * which a deny-list could never promise.
 */
export function isToolVisible(name: string, ctx: VisibilityCtx): boolean {
  if (!ctx.hasThesis) return !ctx.needsThesis;
  return ctx.live ? !DB_CONTENT_MUTATORS.has(name) : !LIVE_DOCX_TOOLS.has(name);
}
```

Move `DB_CONTENT_MUTATORS` and `LIVE_DOCX_TOOLS` into a new `src/lib/ai/mcp-tool-sets.ts` (a leaf with no imports) and have `mcp-bridge.ts` import them from there, so `tool-visibility.ts` does not pull the bridge in. Verify the new module is db-free:

```bash
env -i PATH="$PATH" HOME="$HOME" npx tsx -e 'import("./src/lib/ai/tool-visibility.ts").then(()=>console.log("OK"))'
```

- [ ] **Step 4: Rewire `connectMcpToolset`**

Replace the inline `isVisible` with a call to `isToolVisible`. The bridge already computes which tools declare `thesisId` while building `injectsFor` — **compute `needsThesis` from that same source**, so the two can never disagree. Read that code and thread it through; if the declaration check happens after the filter today, reorder rather than duplicating the logic.

- [ ] **Step 5: Verify + commit**

`npm test` → 979 / 86 files. `npx tsc --noEmit` clean.

```bash
git add src/lib/ai/tool-visibility.ts src/lib/ai/mcp-tool-sets.ts src/lib/ai/mcp-bridge.ts src/__tests__/tool-visibility.test.ts
git commit -m "feat(chat): derive tool visibility from the schema, not a deny-list"
```

---

## Task 2: let a turn run with no thesis

**Files:** `src/routes/chat.ts`.

- [ ] **Step 1: Stop rejecting a null thesis**

`resolveTurnThread` currently ends with:

```ts
  if (!t.thesisId) throw new ThreadAccessError("thread has no thesis attached");
  return { threadId: t.id, thesisId: t.thesisId };
```

That guard existed precisely so this day would be deliberate. Remove it and widen the return to `{ threadId: string; thesisId: string | null }`. Replace the comment with one saying an unattached thread is now a supported state.

- [ ] **Step 2: Follow the nulls**

`tsc` **will** help here (the type genuinely changes from `string` to `string | null`), so let it: run `npx tsc --noEmit` and fix each error deliberately rather than with `!` or a cast. Expect them at `prepareTurnContext`, `insertChatMessage`, `syncOutlineAfterTurn`, `recordRegenerateOutcome`, `turnCheckpointSeq`, and the tool-context construction.

The rules:
- **RAG and document context** — `prepareTurnContext` already guards its thesis row and RAG behind `thesisId ?`. Widen its parameter type to `string | null` and confirm the guards actually cover every use.
- **`insertChatMessage`** already takes `thesisId: string | null`. Nothing to do.
- **Outline sync, doc history checkpoints, regenerate outcomes** — skip entirely when null. There is no document to sync, snapshot or attribute to.
- **`connectMcpToolset`** — pass `thesisId: undefined` and let Task 1's rule hide the doc tools.

- [ ] **Step 3: Tell the model where it stands**

When no thesis is attached, add a line to the system prompt saying so, and that the student can attach one to unlock document editing. Find how the chat turn assembles its system prompt (`featureSystemPrompt` / `THESIS_SYSTEM_PROMPT` in `src/lib/ai/features.ts`) and append there rather than string-concatenating at the call site.

The model must not offer to edit a document it cannot see. Equally it must not claim it has no capabilities at all — it can still explain, plan, draft text and answer questions.

- [ ] **Step 4: Verify**

`npm test` → 976 / 86. `npx tsc --noEmit` clean.

Then a real end-to-end check. Create an unattached thread through the API and send a turn:

```bash
# with a valid bearer token for a real user
curl -s -X POST localhost:3999/api/threads -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
# → note the returned id, then:
curl -s -X POST localhost:3999/api/chat/stream -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"threadId":"<id>","message":"Peux-tu modifier mon document ?"}' --no-buffer | head -c 2000
```

Confirm: the turn completes, the answer says it has no thesis attached rather than claiming an edit, and no doc tool was called. Check `ai_tool_log` for that `turn_id` to be sure.

⚠️ This writes to production (a thread and two messages for a real user). Delete the thread afterwards via `DELETE /api/threads/:id` and confirm it and its messages are gone.

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat.ts src/lib/ai/features.ts
git commit -m "feat(chat): a turn can run with no thesis attached"
```

---

## Task 3: attaching a thesis mid-conversation

Server-side this already works — `sanitizeThreadPatch` accepts `thesisId`, and `patchThread` verifies ownership before setting it. This task proves it and covers the one thing it does not yet handle: the model's memory of what happened before.

**Files:** `src/routes/chat.ts`, `src/__tests__/chat-threads.test.ts`.

- [ ] **Step 1: Test the transition is honest**

The risk is a model that, once attached, describes the earlier part of the conversation as if it had the document all along — or worse, claims it already made an edit. Add a line to the system prompt when the thread has a thesis **and** messages that predate the attachment, noting that the earlier part of the conversation happened without document access.

**This needs a real column.** My first draft proposed reusing `updatedAt` as a
proxy for the attachment moment — that is wrong: `touchThread` stamps `updatedAt`
on *every message insert*, so it tracks last activity, not attachment, and the
comparison would be true for practically every thread. Add the column instead.

`sql/2026-08-10-thread-attached-at.sql`, following the hand-written style of the
two migrations already in that directory (transactional, guarded, re-runnable,
nothing near `templates`):

```sql
BEGIN;
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS attached_at timestamptz;
COMMIT;
```

Add `attachedAt: timestamp("attached_at", { withTimezone: true })` to
`chatThreads` in `src/db/schema.ts`. In `patchThread`, set it whenever
`thesisId` goes from null to non-null, and clear it on detach. Leave it null for
threads that were born attached — "attached at creation" is not a mid-conversation
attachment and needs no warning.

Write the migration but **do not apply it**; report that it is ready and I will
apply it, as with the previous two.

Then a pure helper in `src/lib/chat-threads.ts`, tested alongside the others:

```ts
/**
 * Did this conversation start before a thesis was attached? If so the model has
 * to be told, or it will describe the earlier exchanges as though it had the
 * document all along — or claim an edit it never made.
 *
 * Null attachedAt means the thread was born attached (or never attached), so
 * there is nothing to warn about.
 */
export function attachedMidConversation(attachedAt: Date | null, firstMessageAt: Date | null): boolean {
  if (!attachedAt || !firstMessageAt) return false;
  return firstMessageAt.getTime() < attachedAt.getTime();
}
```

- [ ] **Step 2: Verify + commit**

`npm test` → 979 / 86.

```bash
git add src/routes/chat.ts src/db/schema.ts src/lib/chat-threads.ts src/lib/chat-threads-db.ts sql/2026-08-10-thread-attached-at.sql src/__tests__/chat-threads.test.ts
git commit -m "feat(chat): tell the model when a thesis was attached mid-conversation"
```

---

## Task 4: the app can create and use an unattached chat

**Files:** `components/chat/ChatHistoryPanel.tsx`, `app/(app)/chat.tsx`, `stores/chat-threads-store.ts`, `locales/{en,fr,ar}.json`.

- [ ] **Step 1: ＋ New chat can mean "no thesis"**

The panel's ＋ currently passes `thesisId`. Offer both: a plain "New chat" (unattached) and, when a thesis is in context, "New chat about <thesis>". A long-press or a small menu is fine — match the panel's existing action-sheet pattern rather than inventing a new control.

- [ ] **Step 2: The chat screen works with no thesis**

`app/(app)/chat.tsx`'s default export currently renders `EmptyWriter` when there is no current thesis. That is now wrong: an unattached conversation is a legitimate thing to open. Render the chat when a `threadId` resolves, whether or not a thesis is attached.

`ThesisChat` takes `thesisId: string` today and passes it to `sendMessageToAI(threadId, thesisId, …)`. Widen to `string | null` and follow the nulls — the same discipline as Task 2, and here `tsc` genuinely helps because the type changes.

- [ ] **Step 3: The attach control**

In the composer, when the open thread has no thesis, show an attach affordance (📄 / "Attach a thesis"). Tapping opens the thesis picker the app already has — find it rather than building a second one — and on pick calls `patchThread(threadId, { thesisId })`, then updates the thread in the store.

After attaching, the composer's doc-scoped affordances become available on the next turn. Do not try to retroactively re-render earlier messages.

- [ ] **Step 4: Strings**

Add under `chat.threads`, surgically, in all three locales: `newPlain`, `newAboutThesis`, `attach`, `attachPrompt`, `attached`, `unattachedHint`.

- [ ] **Step 5: Verify**

- `npx tsc --noEmit` clean.
- Locale key counts unchanged-or-higher in all three files (a drop means duplicate keys were destroyed — restore from git).
- `npx expo export --platform ios` succeeds — this catches import and resolution errors `tsc` misses.
- Run it: create a plain chat, ask something general, confirm a sensible answer and no offer to edit a document. Then attach a thesis and confirm the next turn can use the doc tools.

- [ ] **Step 6: Commit**

```bash
git add components/chat/ChatHistoryPanel.tsx "app/(app)/chat.tsx" stores/chat-threads-store.ts locales/en.json locales/fr.json locales/ar.json
git commit -m "feat(chat): create and use a chat with no thesis attached"
```

---

## Done when

- `npm test` → 979 / 86 files, `npx tsc --noEmit` clean on both repos.
- A thread with `thesis_id IS NULL` can hold a full conversation.
- With no thesis attached, no tool declaring `thesisId` is offered to the model — verified in `ai_tool_log`, not assumed.
- Attaching a thesis mid-conversation unlocks the doc tools on the next turn, and the model does not pretend it had them earlier.
- Everything from plans 1–2 still works: the shim, the history panel, search, auto-titles.
