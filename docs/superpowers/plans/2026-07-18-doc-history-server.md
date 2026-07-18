# Thesis Document History (Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Snapshot ring buffer (last 20 pre-edit .docx states per thesis) captured by ONE shared persist helper at every mutation path, plus undo/redo/restore endpoints and AI-turn checkpoint tagging.

**Architecture:** A pure-logic core (`thesis-history-core.ts`, unit-tested) + a thin IO module (`thesis-history.ts`) that snapshots via Supabase storage-side copy before each overwrite. Every writer (REST handlers, AI `persistDoc`, `/apply`, `/format`, OnlyOffice callback, re-seed) refactors onto `persistThesisDocx()`. Undo/redo use a cursor column on `theses`; AI edits are tagged with a per-turn id via AsyncLocalStorage so "undo this AI turn" is just "restore the earliest snapshot of that turn".

**Tech Stack:** Hono, Drizzle (pg), Supabase Storage (`copy`), mdocxengine, vitest. Repo: `/Users/hamzasafwan/modakerati-server` (plan doc lives in the app repo).

**Spec:** `docs/superpowers/specs/2026-07-18-doc-history-ai-confirm-design.md` (app repo).

**Conventions:** All history reads/writes happen inside the caller's `withThesisLock` (NOT reentrant — never re-acquire inside). Snapshots are best-effort: a failed copy logs and never blocks an edit. Tests are pure (no DB), matching `src/__tests__/` style. Run tests with `npx vitest run <file>`; typecheck with `npx tsc --noEmit`.

---

### Task 1: Pure cursor/ring semantics — `thesis-history-core.ts`

**Files:**
- Create: `src/lib/thesis-history-core.ts`
- Test: `src/__tests__/thesis-history-core.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/thesis-history-core.test.ts
import { describe, expect, it } from "vitest";
import {
  undoTarget, redoTarget, cursorAfterRestore, pruneList, canUndo, canRedo,
} from "../lib/thesis-history-core";

// entries = history seqs sorted ASC; cursor = theses.historyCursorSeq (null = at tip)
describe("undoTarget", () => {
  it("at tip returns the newest entry", () => expect(undoTarget([1, 2, 5], null)).toBe(5));
  it("mid-history returns the next-older entry", () => expect(undoTarget([1, 2, 5], 5)).toBe(2));
  it("skips gaps (pruned seqs)", () => expect(undoTarget([1, 5, 9], 5)).toBe(1));
  it("null when nothing older", () => expect(undoTarget([1, 2], 1)).toBeNull());
  it("null when history is empty", () => expect(undoTarget([], null)).toBeNull());
});

describe("redoTarget", () => {
  it("null at tip (nothing undone)", () => expect(redoTarget([1, 2], null)).toBeNull());
  it("returns the next-newer entry", () => expect(redoTarget([1, 2, 5], 2)).toBe(5));
  it("null when cursor is already the newest entry", () => expect(redoTarget([1, 2], 2)).toBeNull());
});

describe("cursorAfterRestore", () => {
  it("restoring the newest entry returns to the tip (null cursor)", () =>
    expect(cursorAfterRestore([1, 2, 5], 5)).toBeNull());
  it("restoring an older entry parks the cursor there", () =>
    expect(cursorAfterRestore([1, 2, 5], 2)).toBe(2));
});

describe("pruneList", () => {
  it("keeps the newest `max` entries", () => expect(pruneList([1, 2, 3, 4, 5], 3)).toEqual([1, 2]));
  it("no-op under the cap", () => expect(pruneList([1, 2], 20)).toEqual([]));
});

describe("canUndo / canRedo", () => {
  it("mirror the targets", () => {
    expect(canUndo([1], null)).toBe(true);
    expect(canUndo([], null)).toBe(false);
    expect(canRedo([1, 2], 1)).toBe(true);
    expect(canRedo([1, 2], null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/hamzasafwan/modakerati-server && npx vitest run src/__tests__/thesis-history-core.test.ts`
Expected: FAIL — cannot resolve `../lib/thesis-history-core`.

- [ ] **Step 3: Implement**

```ts
// src/lib/thesis-history-core.ts
// Pure undo/redo cursor semantics over the thesis_doc_history ring buffer.
// `entries` is always the thesis's history seqs sorted ASC; `cursor` is
// theses.historyCursorSeq — null means the live doc is at the tip (nothing
// undone). Rows are PRE-edit states: undoing from the tip first snapshots the
// current doc (so redo can return), then restores the newest pre-existing row.

export function undoTarget(entries: number[], cursor: number | null): number | null {
  const older = cursor == null ? entries : entries.filter((s) => s < cursor);
  return older.length ? older[older.length - 1] : null;
}

export function redoTarget(entries: number[], cursor: number | null): number | null {
  if (cursor == null) return null;
  const newer = entries.filter((s) => s > cursor);
  return newer.length ? newer[0] : null;
}

// Restoring the newest row means returning to the pre-undo tip state.
export function cursorAfterRestore(entries: number[], target: number): number | null {
  return entries.length && target === entries[entries.length - 1] ? null : target;
}

// Seqs to delete so only the newest `max` remain.
export function pruneList(entries: number[], max: number): number[] {
  return entries.length <= max ? [] : entries.slice(0, entries.length - max);
}

export const canUndo = (entries: number[], cursor: number | null): boolean =>
  undoTarget(entries, cursor) != null;

export const canRedo = (entries: number[], cursor: number | null): boolean =>
  redoTarget(entries, cursor) != null;
```

- [ ] **Step 4: Run tests — expect PASS**, then `npx tsc --noEmit` — expect clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/thesis-history-core.ts src/__tests__/thesis-history-core.test.ts
git commit -m "feat(history): pure undo/redo cursor semantics for the doc-history ring buffer"
```

---

### Task 2: Schema — `thesis_doc_history` table + `theses` columns

**Files:**
- Modify: `src/db/schema.ts` (theses table ~line 60-87; new table after `thesisLocks` ~line 277)

- [ ] **Step 1: Add two columns to `theses`** (after `docMode`, before `createdAt`):

```ts
  // Doc-history support: sha256 of the CURRENT stored .docx bytes (written by
  // every persist; lets the next snapshot dedupe without a download), and the
  // undo cursor — the history seq the live doc currently equals (null = at tip).
  docHash: text("doc_hash"),
  historyCursorSeq: integer("history_cursor_seq"),
```

- [ ] **Step 2: Add the history table** after the `thesisLocks` definition:

```ts
// ============================================================
// Thesis doc history (undo/redo snapshot ring buffer)
// ============================================================
// One row per PRE-edit .docx state, copied to `{userId}/{thesisId}.history/{seq}.docx`
// right before each overwrite of the working doc. Capped at THESIS_HISTORY_MAX
// (default 20) per thesis; see lib/thesis-history.ts for the ring/cursor logic.
export const thesisDocHistory = pgTable(
  "thesis_doc_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    storagePath: text("storage_path").notNull(),
    docHash: text("doc_hash"),
    label: text("label").notNull().default(""),
    source: text("source").notNull().default("manual"), // ai | manual | onlyoffice | restore | import
    turnId: text("turn_id"), // chat turn that produced the edit (AI sources)
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("thesis_doc_history_thesis_seq").on(t.thesisId, t.seq)],
);
```

Add `uniqueIndex` to the existing `drizzle-orm/pg-core` import in schema.ts if absent. (The spec's optional `sizeBytes` column is deliberately omitted — the pre-edit object's size isn't knowable at copy time without a download, and the app UI doesn't need it.)

- [ ] **Step 3: Verify the export surface.** `src/db/index.ts` re-exports the schema (check: `grep -n "export" src/db/index.ts | head`). If it re-exports named tables individually, add `thesisDocHistory`; if `export * from "./schema"`, nothing to do.

- [ ] **Step 4: Apply the schema** (local Supabase must be running; this is the repo's 2-step convention, drizzle push only):

Run: `npx drizzle-kit push`
Expected: adds `thesis_doc_history` + 2 columns on `theses`, no destructive changes. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/index.ts
git commit -m "feat(history): thesis_doc_history table + docHash/historyCursorSeq on theses"
```

---

### Task 3: Turn context (AsyncLocalStorage) — who is editing, from which chat turn

**Files:**
- Create: `src/lib/ai/turn-context.ts`
- Modify: `src/lib/ai/mcp-bridge.ts` (ctx + callTool, lines 88 & 138-151)

- [ ] **Step 1: Create the context module**

```ts
// src/lib/ai/turn-context.ts
// Carries the chat turn id + tool name across the in-process MCP call chain so
// deep code (doc-tools persistDoc → thesis-history) can tag snapshots with the
// AI turn that produced them — without threading params through 30 tool schemas.
// The MCP transport is in-memory (same async chain), so ALS context propagates.
import { AsyncLocalStorage } from "node:async_hooks";

interface ToolCallCtx {
  turnId?: string;
  toolName?: string;
}

const als = new AsyncLocalStorage<ToolCallCtx>();

export function runWithToolContext<T>(ctx: ToolCallCtx, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export const currentTurnId = (): string | undefined => als.getStore()?.turnId;
export const currentToolName = (): string | undefined => als.getStore()?.toolName;
```

- [ ] **Step 2: Thread `turnId` through the bridge.** In `mcp-bridge.ts`:
  - Add to the `connectMcpToolset` ctx type: `turnId?: string` → `ctx: { userId: string; docMode?: string; thesisId?: string; turnId?: string }`.
  - Import: `import { runWithToolContext } from "./turn-context";`
  - In `callTool`, wrap the client call (line ~144):

```ts
    const res = await runWithToolContext({ turnId: ctx.turnId, toolName: name }, () =>
      client.callTool({ name, arguments: merged }),
    );
```

- [ ] **Step 3: Generate a turn id per chat turn.** In `src/lib/ai/tool-loop.ts`, both `chatWithTools` (~line 656 in current numbering: `const toolset = await connectMcpToolset({...})`) and `streamChatWithTools` (~line 598) pass it through:

```ts
  const turnId = (globalThis.crypto ?? require("node:crypto")).randomUUID();
  const toolset = await connectMcpToolset({ userId: opts.userId, docMode: opts.docMode, thesisId: opts.thesisId, turnId });
```

(Use `import { randomUUID } from "node:crypto";` at the top instead of the inline require — Node ≥ 20.) Also expose it on the result: add `turnId: string` to both `ToolChatResult` and `StreamResult` interfaces and set it in every `return`/`result()` construction (`const result = (): StreamResult => ({ turnId, ... })` in the streaming loop; add `turnId` to each `return {...}` object in `chatWithTools`).

- [ ] **Step 4: Verify** `npx tsc --noEmit` — clean (the compiler will point at any `return` site missing `turnId`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/turn-context.ts src/lib/ai/mcp-bridge.ts src/lib/ai/tool-loop.ts
git commit -m "feat(history): per-turn ALS context so doc edits can be tagged with their chat turn"
```

---

### Task 4: IO module — `thesis-history.ts` (snapshot, persist, restore, status)

**Files:**
- Create: `src/lib/thesis-history.ts`

No unit test (all IO; the logic lives in Task 1). Verification is `tsc` + the endpoint smoke test in Task 7.

- [ ] **Step 1: Create the module**

```ts
// src/lib/thesis-history.ts
// Snapshot ring buffer + undo/redo over the working .docx. EVERY caller of the
// write functions must already hold withThesisLock(thesisId) — the lock is NOT
// reentrant, so nothing here re-acquires it. Snapshots are best-effort: a
// failed storage copy logs loudly and never blocks the edit itself.
import { createHash } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Mdocxengine } from "mdocxengine";
import { db, theses, thesisDocHistory } from "../db";
import { supabaseAdmin } from "./supabase";
import { uploadDocx, downloadDocx } from "./document-storage";
import { commitThesisEngine, invalidateThesisEngine } from "./thesis-engine-cache";
import { scheduleReconcile } from "./rag/thesis-index";
import { buildDocumentDTOFromEngine } from "./thesis-doc";
import {
  undoTarget, redoTarget, cursorAfterRestore, pruneList, canUndo, canRedo,
} from "./thesis-history-core";

const BUCKET = process.env.DOCUMENTS_BUCKET || "documents";
export const HISTORY_MAX = Math.max(1, Number(process.env.THESIS_HISTORY_MAX ?? 20));

export type HistorySource = "ai" | "manual" | "onlyoffice" | "restore" | "import";

const hashOf = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");
const historyPath = (userId: string, thesisId: string, seq: number): string =>
  `${userId}/${thesisId}.history/${seq}.docx`;

interface ThesisHistState {
  docHash: string | null;
  cursor: number | null;
  docPath: string | null;
}

async function readState(thesisId: string): Promise<ThesisHistState> {
  const [row] = await db
    .select({ docHash: theses.docHash, cursor: theses.historyCursorSeq, docPath: theses.docPath })
    .from(theses)
    .where(eq(theses.id, thesisId));
  return { docHash: row?.docHash ?? null, cursor: row?.cursor ?? null, docPath: row?.docPath ?? null };
}

async function listSeqs(thesisId: string): Promise<number[]> {
  const rows = await db
    .select({ seq: thesisDocHistory.seq })
    .from(thesisDocHistory)
    .where(eq(thesisDocHistory.thesisId, thesisId))
    .orderBy(asc(thesisDocHistory.seq));
  return rows.map((r) => r.seq);
}

async function deleteRows(thesisId: string, seqs: number[], userId: string): Promise<void> {
  if (!seqs.length) return;
  const paths = seqs.map((s) => historyPath(userId, thesisId, s));
  await db.delete(thesisDocHistory).where(
    and(eq(thesisDocHistory.thesisId, thesisId), inArray(thesisDocHistory.seq, seqs)),
  );
  // Storage cleanup is best-effort — an orphaned object is invisible (rows are
  // the source of truth) and cheaper than failing the edit.
  supabaseAdmin.storage.from(BUCKET).remove(paths).then(
    () => {},
    (e: unknown) => console.warn("history object cleanup failed:", thesisId, e),
  );
}

/**
 * Copy the CURRENT stored .docx into the next history slot. Dedupes against the
 * newest row via theses.docHash (the hash of the currently-stored bytes, written
 * by the previous persist). Returns the new seq, or null when skipped/failed.
 * Caller holds the thesis lock.
 */
export async function snapshotCurrentDoc(o: {
  thesisId: string;
  userId: string;
  label: string;
  source: HistorySource;
  turnId?: string;
}): Promise<number | null> {
  try {
    const state = await readState(o.thesisId);
    const docPath = state.docPath ?? `${o.userId}/${o.thesisId}.docx`;
    const seqs = await listSeqs(o.thesisId);
    if (seqs.length && state.docHash != null) {
      const [newest] = await db
        .select({ docHash: thesisDocHistory.docHash })
        .from(thesisDocHistory)
        .where(and(eq(thesisDocHistory.thesisId, o.thesisId), eq(thesisDocHistory.seq, seqs[seqs.length - 1])));
      if (newest?.docHash != null && newest.docHash === state.docHash) return null; // identical state already snapshotted
    }
    const seq = (seqs[seqs.length - 1] ?? 0) + 1;
    const snapPath = historyPath(o.userId, o.thesisId, seq);
    const { error } = await supabaseAdmin.storage.from(BUCKET).copy(docPath, snapPath);
    if (error) {
      // First-ever upload: there is no previous object to snapshot — silent skip.
      if (/not.?found/i.test(error.message)) return null;
      throw new Error(error.message);
    }
    await db.insert(thesisDocHistory).values({
      thesisId: o.thesisId, seq, storagePath: snapPath, docHash: state.docHash,
      label: o.label, source: o.source, turnId: o.turnId ?? null,
    });
    return seq;
  } catch (e: any) {
    console.error("thesis history snapshot FAILED (edit proceeds):", o.thesisId, e?.message ?? e);
    return null;
  }
}

/**
 * THE shared write path: snapshot pre-edit state → upload new bytes → reconcile
 * RAG → bump updatedAt (via commitThesisEngine when the bytes came from a
 * cacheable engine, else invalidate + manual bump) → prune the ring. A new edit
 * always truncates the redo tail and resets the cursor to the tip.
 * Caller holds withThesisLock(thesisId).
 */
export async function persistThesisDocx(o: {
  thesisId: string;
  userId: string;
  buffer: Buffer;
  engine?: Mdocxengine;      // omit when bytes were produced outside a cacheable engine
  extra?: Partial<typeof theses.$inferInsert>;
  label: string;
  source: HistorySource;
  turnId?: string;
  commitBestEffort?: boolean; // AI tool path: a failed updatedAt bump must not fail the tool
}): Promise<{ canUndo: boolean; canRedo: boolean }> {
  const state = await readState(o.thesisId);

  // Redo tail dies on a new edit (standard editor semantics).
  if (state.cursor != null) {
    const seqs = await listSeqs(o.thesisId);
    await deleteRows(o.thesisId, seqs.filter((s) => s > state.cursor!), o.userId);
  }

  await snapshotCurrentDoc({
    thesisId: o.thesisId, userId: o.userId, label: o.label, source: o.source, turnId: o.turnId,
  });

  await uploadDocx(o.userId, o.thesisId, o.buffer);
  scheduleReconcile(o.thesisId, o.buffer);

  const patch = { ...(o.extra ?? {}), docHash: hashOf(o.buffer), historyCursorSeq: null };
  if (o.engine) {
    const commit = commitThesisEngine(o.thesisId, o.engine, patch);
    if (o.commitBestEffort) await commit.catch(() => {});
    else await commit;
  } else {
    invalidateThesisEngine(o.thesisId);
    await db.update(theses).set({ ...patch, updatedAt: new Date() }).where(eq(theses.id, o.thesisId));
  }

  // Ring prune, off the critical path.
  listSeqs(o.thesisId)
    .then((seqs) => deleteRows(o.thesisId, pruneList(seqs, HISTORY_MAX), o.userId))
    .catch((e) => console.warn("history prune failed:", o.thesisId, e?.message ?? e));

  const seqs = await listSeqs(o.thesisId);
  return { canUndo: canUndo(seqs, null), canRedo: false };
}

export interface HistoryEntryDTO {
  seq: number;
  label: string;
  source: HistorySource;
  turnId: string | null;
  createdAt: string | null;
}

export async function getHistoryStatus(thesisId: string): Promise<{
  entries: HistoryEntryDTO[];
  cursorSeq: number | null;
  canUndo: boolean;
  canRedo: boolean;
}> {
  const [state, rows] = await Promise.all([
    readState(thesisId),
    db.select().from(thesisDocHistory)
      .where(eq(thesisDocHistory.thesisId, thesisId))
      .orderBy(asc(thesisDocHistory.seq)),
  ]);
  const seqs = rows.map((r) => r.seq);
  return {
    entries: rows
      .map((r) => ({
        seq: r.seq,
        label: r.label,
        source: r.source as HistorySource,
        turnId: r.turnId,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
      }))
      .reverse(), // newest first for the app's history sheet
    cursorSeq: state.cursor,
    canUndo: canUndo(seqs, state.cursor),
    canRedo: canRedo(seqs, state.cursor),
  };
}

/**
 * Restore the doc to history row `targetSeq`. When at the tip, first snapshots
 * the current state (label "Before undo") so redo can return to it. Returns the
 * fresh DocumentDTO + button state. Caller holds withThesisLock(thesisId) and
 * has verified ownership. `thesis` is the caller's already-fetched row.
 */
export async function restoreThesisToSeq(
  thesis: { id: string; userId: string; title: string; docPath: string | null; docMode: string | null } & Record<string, unknown>,
  targetSeq: number,
): Promise<{ document: unknown; canUndo: boolean; canRedo: boolean } | { error: string }> {
  const state = await readState(thesis.id);
  const [target] = await db.select().from(thesisDocHistory).where(
    and(eq(thesisDocHistory.thesisId, thesis.id), eq(thesisDocHistory.seq, targetSeq)),
  );
  if (!target) return { error: "History entry not found" };

  if (state.cursor == null) {
    await snapshotCurrentDoc({
      thesisId: thesis.id, userId: thesis.userId, label: "Before undo", source: "restore",
    });
  }

  const bytes = await downloadDocx(target.storagePath);
  await uploadDocx(thesis.userId, thesis.id, bytes);
  scheduleReconcile(thesis.id, bytes);

  const seqs = await listSeqs(thesis.id);
  const cursor = cursorAfterRestore(seqs, targetSeq);
  // Bytes came from storage, not a cached engine → invalidate + manual bump.
  invalidateThesisEngine(thesis.id);
  await db.update(theses)
    .set({ docHash: hashOf(bytes), historyCursorSeq: cursor, updatedAt: new Date() })
    .where(eq(theses.id, thesis.id));

  const engine = await Mdocxengine.loadFromBuffer(bytes);
  const document = await buildDocumentDTOFromEngine(thesis as never, engine);
  return { document, canUndo: canUndo(seqs, cursor), canRedo: canRedo(seqs, cursor) };
}

/** Undo one step; `{error}` when there is nothing to undo. Caller holds the lock. */
export async function undoThesis(
  thesis: Parameters<typeof restoreThesisToSeq>[0],
): Promise<ReturnType<typeof restoreThesisToSeq> extends Promise<infer R> ? R : never> {
  const state = await readState(thesis.id);
  const target = undoTarget(await listSeqs(thesis.id), state.cursor);
  if (target == null) return { error: "Nothing to undo" };
  return restoreThesisToSeq(thesis, target);
}

/** Redo one step; `{error}` when there is nothing to redo. Caller holds the lock. */
export async function redoThesis(
  thesis: Parameters<typeof restoreThesisToSeq>[0],
): Promise<ReturnType<typeof restoreThesisToSeq> extends Promise<infer R> ? R : never> {
  const state = await readState(thesis.id);
  const target = redoTarget(await listSeqs(thesis.id), state.cursor);
  if (target == null) return { error: "Nothing to redo" };
  return restoreThesisToSeq(thesis, target);
}

/** Remove ALL history objects + rows for a thesis (thesis deletion). */
export async function purgeThesisHistory(thesisId: string, userId: string): Promise<void> {
  const seqs = await listSeqs(thesisId);
  await deleteRows(thesisId, seqs, userId);
}
```

Also add `inArray` to the drizzle-orm import line.

Note on `undoThesis`/`redoThesis` return typing: if the conditional-type helper reads poorly, define `type RestoreResult = Awaited<ReturnType<typeof restoreThesisToSeq>>` and use it for both — same meaning, simpler.

- [ ] **Step 2: Verify** `npx tsc --noEmit` — clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/thesis-history.ts
git commit -m "feat(history): snapshot/persist/restore IO module over the ring buffer"
```

---

### Task 5: Refactor every REST writer in `thesis.ts` onto `persistThesisDocx`

**Files:**
- Modify: `src/routes/thesis.ts`

Each handler currently inlines the same 3–4 line persist sequence. Replace each occurrence with one `persistThesisDocx` call carrying a human label. The handlers keep their surrounding logic and return shapes; where they returned `document`, additionally spread the returned `{canUndo, canRedo}` as a `history` field.

- [ ] **Step 1: Import the helper.** Add to the imports:

```ts
import { persistThesisDocx, purgeThesisHistory } from "../lib/thesis-history";
```

- [ ] **Step 2: Replace the persist sequence in the seven engine-backed handlers.** The current pattern (exact code at each site, comments elided):

```ts
      const buf = engine.zip.toBuffer();
      await uploadDocx(userId, id, Buffer.from(buf));
      scheduleReconcile(id, Buffer.from(buf));
      await commitThesisEngine(id, engine);
```

becomes (per-site `label` from the table below):

```ts
      const history = await persistThesisDocx({
        thesisId: id, userId, buffer: Buffer.from(engine.zip.toBuffer()),
        engine, label: "<LABEL>", source: "manual",
      });
```

and each `return { ok: true as const, ..., document }` gains `history`:
`return { ok: true as const, ..., document, history };` (handlers without a `document` echo — image replace, remove-bg, page-setup — also add `history` to their `{ ok: true }` returns).

| Handler (current line of `uploadDocx`) | label |
|---|---|
| `PUT /:id/paragraphs/:index` (263) | `"Edit paragraph"` |
| `POST /:id/paragraphs/bulk` (353) | `"Format paragraphs"` |
| `POST /:id/blocks/delete` (399) | `` `Delete ${ordered.length} block(s)` `` |
| `POST /:id/blocks/move` (440) | `"Move block"` |
| `POST /:id/blocks/image` (496 — uses `doc.toBuffer()`/`doc.engine`) | `"Insert image"` — pass `buffer: Buffer.from(doc.toBuffer()), engine: doc.engine` |
| `POST /:id/blocks/:index/image` (545) | `"Replace image"` |
| `POST /:id/blocks/:index/remove-bg` (588) | `"Remove image background"` |
| `POST /:id/blocks/start-on-new-page` (644) | `"Start on new page"` |
| `POST /:id/page-setup` (696 — note: currently has NO `scheduleReconcile`; the helper adds it, which is a fix) | `"Page setup"` |

- [ ] **Step 3: The two whole-doc rewrite handlers** (bytes NOT from a cacheable engine → omit `engine`):

`POST /:id/apply` — replace lines ~1186-1190 (`await uploadDocx(...)` through the manual `db.update ... updatedAt`) with:

```ts
          await persistThesisDocx({
            thesisId: thesis.id, userId, buffer: Buffer.from(buffer),
            label: "Apply analysis fixes", source: "manual",
          });
```

(delete the now-redundant `invalidateThesisEngine` + `db.update` lines; the helper does both, and also adds the previously-missing `scheduleReconcile`).

`POST /:id/format` — replace the `await uploadDocx(userId, thesis.id, outBuffer)` + `invalidateThesisEngine` + `db.update(...patch...)` block (~1235-1250) with:

```ts
      const patch: Partial<typeof theses.$inferInsert> = {};
      if (profileId !== thesis.normProfileId) patch.normProfileId = profileId;
      await persistThesisDocx({
        thesisId: thesis.id, userId, buffer: outBuffer,
        extra: patch, label: "Thesis-ready formatting", source: "manual",
      });
```

- [ ] **Step 4: Seed/import paths** (first upload usually has nothing to snapshot — `snapshotCurrentDoc` silently skips a missing source object; a RE-seed of an existing doc does get a snapshot):
  - `POST /import` (~792) and `POST /combine` (~946): replace `const docPath = await uploadDocx(...); scheduleReconcile(...); await db.update(theses).set({ docPath })...` with:

```ts
  const docPath = `${userId}/${thesis.id}.docx`;
  await persistThesisDocx({
    thesisId: thesis.id, userId, buffer, // `finalBuffer` in /combine
    extra: { docPath }, label: "Import", source: "import",
  });
  thesis.docPath = docPath;
```

  - `PUT /:id` re-seed (~1041): replace `await uploadDocx(userId, thesis.id, Buffer.from(newBuffer));` with:

```ts
        await persistThesisDocx({
          thesisId: thesis.id, userId, buffer: Buffer.from(newBuffer),
          label: "Template re-seed", source: "import",
        });
```

- [ ] **Step 5: Thesis deletion cleans its history.** In `DELETE /:id` (~1069), before the `db.delete`:

```ts
  await purgeThesisHistory(id, userId).catch(() => {});
```

- [ ] **Step 6: Remove now-unused imports** if `scheduleReconcile`/`commitThesisEngine` have no remaining uses in thesis.ts (`invalidateThesisEngine` keeps its DELETE-handler use). `npx tsc --noEmit` — clean. Run the full suite: `npx vitest run` — all pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/thesis.ts
git commit -m "refactor(history): all REST doc writers persist via persistThesisDocx (snapshots on)"
```

---

### Task 6: AI tools + OnlyOffice callback onto the shared persist

**Files:**
- Modify: `src/mcp/doc-tools.ts` (`persistDoc`, lines 85-97)
- Modify: `src/routes/onlyoffice.ts` (callback save, ~line 66-75)

- [ ] **Step 1: Refactor `persistDoc`.** Replace its body:

```ts
/** Save a mutated `Doc` back to storage and refresh best-effort stats. Returns the block count. */
async function persistDoc(doc: Doc, thesis: LiveThesis): Promise<number> {
  const buf = Buffer.from(doc.toBuffer());
  const words = await doc.wordCount();
  const pages = Math.max(1, Math.ceil(words / 250));
  await persistThesisDocx({
    thesisId: thesis.id,
    userId: thesis.userId,
    buffer: buf,
    engine: doc.engine,
    extra: { wordCount: words, pageCount: pages },
    label: `AI: ${currentToolName() ?? "edit"}`,
    source: "ai",
    turnId: currentTurnId(),
    commitBestEffort: true, // a failed updatedAt bump must not fail the tool (pre-existing behavior)
  });
  return (await doc.blocks()).length;
}
```

Imports to add in doc-tools.ts: `import { persistThesisDocx } from "../lib/thesis-history";` and `import { currentTurnId, currentToolName } from "../lib/ai/turn-context";`. Remove the now-unused `uploadDocx`/`scheduleReconcile`/`commitThesisEngine` imports IF nothing else in the file uses them (grep first — `loadThesisEngine`/`invalidateThesisEngine` stay).

- [ ] **Step 2: OnlyOffice callback.** In `onlyoffice.ts`, replace the locked body (`await uploadDocx(...)` through the `db.update ... updatedAt`) with:

```ts
      await withThesisLock(thesisId, async () => {
        await persistThesisDocx({
          thesisId, userId: thesis.userId, buffer: buf,
          label: "OnlyOffice save", source: "onlyoffice",
        });
      });
```

Import `persistThesisDocx`; drop unused imports.

- [ ] **Step 3: Verify** `npx tsc --noEmit` + `npx vitest run` — clean/pass.

- [ ] **Step 4: Commit**

```bash
git add src/mcp/doc-tools.ts src/routes/onlyoffice.ts
git commit -m "refactor(history): AI persistDoc + OnlyOffice save snapshot via persistThesisDocx"
```

---

### Task 7: History endpoints

**Files:**
- Create: `src/routes/thesis-history.ts`
- Modify: `src/index.ts` (mount)

- [ ] **Step 1: Create the router**

```ts
// src/routes/thesis-history.ts
// Undo/redo/restore + history listing for the working .docx. All mutations run
// inside withThesisLock and echo the full DocumentDTO so the app reconciles in
// one round-trip (same contract as the block-edit endpoints in thesis.ts).
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppVariables } from "../types";
import { db, theses } from "../db";
import { withThesisLock } from "../lib/thesis-lock";
import {
  getHistoryStatus, restoreThesisToSeq, undoThesis, redoThesis,
} from "../lib/thesis-history";

export const thesisHistoryRoutes = new Hono<{ Variables: AppVariables }>();

async function ownedLiveThesis(userId: string, id: string) {
  const [thesis] = await db.select().from(theses).where(and(eq(theses.id, id), eq(theses.userId, userId)));
  if (!thesis) return { error: "Thesis not found" as const, status: 404 as const };
  if (thesis.docMode !== "live-docx" || !thesis.docPath) {
    return { error: "Thesis is not a live Word document" as const, status: 400 as const };
  }
  return { thesis };
}

thesisHistoryRoutes.get("/:id/history", async (c) => {
  const found = await ownedLiveThesis(c.get("userId"), c.req.param("id"));
  if ("error" in found) return c.json({ error: found.error }, found.status);
  return c.json(await getHistoryStatus(found.thesis.id));
});

function historyAction(kind: "undo" | "redo" | "restore") {
  return async (c: any) => {
    const found = await ownedLiveThesis(c.get("userId"), c.req.param("id"));
    if ("error" in found) return c.json({ error: found.error }, found.status);
    const { thesis } = found;
    try {
      const result = await withThesisLock(thesis.id, async () => {
        if (kind === "restore") {
          const body = await c.req.json().catch(() => ({}));
          const seq = Number(body?.seq);
          if (!Number.isInteger(seq)) return { error: "seq required" };
          return restoreThesisToSeq(thesis, seq);
        }
        return kind === "undo" ? undoThesis(thesis) : redoThesis(thesis);
      });
      if ("error" in result) return c.json({ error: result.error }, 400);
      return c.json({ ok: true, ...result });
    } catch (e: any) {
      console.error(`thesis history ${kind} failed:`, thesis.id, e?.message ?? e);
      return c.json({ error: `${kind} failed` }, 500);
    }
  };
}

thesisHistoryRoutes.post("/:id/history/undo", historyAction("undo"));
thesisHistoryRoutes.post("/:id/history/redo", historyAction("redo"));
thesisHistoryRoutes.post("/:id/history/restore", historyAction("restore"));
```

- [ ] **Step 2: Mount it.** Find the thesis mount in `src/index.ts` (`grep -n '"/api/thesis"' src/index.ts` → `app.route("/api/thesis", thesisRoutes)`) and add directly after:

```ts
app.route("/api/thesis", thesisHistoryRoutes);
```

with the import `import { thesisHistoryRoutes } from "./routes/thesis-history";`. (Hono composes multiple routers on one base path; the paths are disjoint from thesis.ts's.)

- [ ] **Step 3: Smoke test end-to-end** (needs local Supabase + `npm run dev` + a live-docx thesis id and auth token — reuse whatever the repo's usual manual flow is):
  1. `GET /api/thesis/:id/history` → `{ entries: [], cursorSeq: null, canUndo: false, canRedo: false }` on a fresh thesis.
  2. Make an edit (e.g. `POST /:id/blocks/delete` body `{"indices":[5]}`) → response now carries `history: { canUndo: true, canRedo: false }`.
  3. `POST /:id/history/undo` → `{ ok, document, canUndo, canRedo: true }` and the deleted block is back in `document.blocks`.
  4. `POST /:id/history/redo` → block gone again, `canRedo: false`.
  5. Undo, then make a different edit → `GET history` shows the redo tail dropped (no entry newer than the new edit's snapshot).

- [ ] **Step 4: Commit**

```bash
git add src/routes/thesis-history.ts src/index.ts
git commit -m "feat(history): undo/redo/restore + history listing endpoints"
```

---

### Task 8: AI turn checkpoint frame (`[[MODK_DOCCHANGES]]`)

**Files:**
- Modify: `src/lib/ai/tool-loop.ts` (frame constants ~line 60, `stripControlFrames` ~line 130)
- Modify: `src/routes/chat.ts` (`/send` ~line 165, `/stream` ~line 255)

- [ ] **Step 1: Frame + payload in tool-loop.ts** (next to the FILE frame definitions):

```ts
// Doc-changes frame: emitted at the END of a turn whose tools mutated the .docx.
// Carries the turn's checkpoint (earliest history snapshot of the turn) so the
// app can offer one-tap "Undo AI changes". Ephemeral — stripped before persist.
export const DOCCHANGES_FRAME_OPEN = "[[MODK_DOCCHANGES]]";
export const DOCCHANGES_FRAME_CLOSE = "[[/MODK_DOCCHANGES]]";

export interface DocChangesPayload {
  kind: "docChanges";
  turnId: string;
  checkpointSeq: number;
  tools: string[];
}

export function makeDocChangesFrame(p: DocChangesPayload): string {
  return `${DOCCHANGES_FRAME_OPEN}${JSON.stringify(p)}${DOCCHANGES_FRAME_CLOSE}`;
}
```

And extend `stripControlFrames` with two more replaces (same shape as the ASK pair):

```ts
    .replace(/\[\[MODK_DOCCHANGES\]\][\s\S]*?\[\[\/MODK_DOCCHANGES\]\]/g, "")
    .replace(/\[\[MODK_DOCCHANGES\]\][\s\S]*$/g, "")
```

- [ ] **Step 2: Build the payload after a turn.** Add to `src/lib/thesis-history.ts`:

```ts
/** Earliest snapshot of a chat turn = the checkpoint "undo this AI turn" restores to. */
export async function turnCheckpointSeq(thesisId: string, turnId: string): Promise<number | null> {
  const [row] = await db
    .select({ seq: thesisDocHistory.seq })
    .from(thesisDocHistory)
    .where(and(eq(thesisDocHistory.thesisId, thesisId), eq(thesisDocHistory.turnId, turnId)))
    .orderBy(asc(thesisDocHistory.seq))
    .limit(1);
  return row?.seq ?? null;
}
```

- [ ] **Step 3: Emit it from both chat routes.** In `routes/chat.ts` import `turnCheckpointSeq` and `makeDocChangesFrame` (add to the existing `../lib/ai` barrel import if re-exported there — check `src/lib/ai/index.ts`; otherwise import from `"../lib/ai/tool-loop"`).

`/stream`: right after the generator loop finishes (`if (next.done) { telemetry = next.value; break; }` block, before `const stopped = ...`):

```ts
      // Turn mutated the doc? Emit the checkpoint frame so the app can offer
      // one-tap "Undo AI changes". (Ephemeral — stripControlFrames drops it
      // from the persisted message.)
      if (telemetry?.turnId && thesisId) {
        const seq = await turnCheckpointSeq(thesisId, telemetry.turnId).catch(() => null);
        if (seq != null) {
          const frame = makeDocChangesFrame({
            kind: "docChanges", turnId: telemetry.turnId, checkpointSeq: seq,
            tools: [...new Set(telemetry.toolCalls.map((t) => t.name))],
          });
          full += frame;
          await stream.write(streamSafe(frame));
        }
      }
```

`/send`: before building the JSON response:

```ts
    let docChanges: DocChangesPayload | undefined;
    if (response.turnId && thesisId) {
      const seq = await turnCheckpointSeq(thesisId, response.turnId).catch(() => null);
      if (seq != null) {
        docChanges = { kind: "docChanges", turnId: response.turnId, checkpointSeq: seq,
          tools: [...new Set(response.toolCalls.map((t) => t.name))] };
      }
    }
```

and add `docChanges` to the returned JSON object.

- [ ] **Step 4: Verify** `npx tsc --noEmit` + `npx vitest run`. Then a manual chat smoke: send a workspace chat message that edits the doc (e.g. "fix the typo in block 3") and confirm the streamed response ends with a `[[MODK_DOCCHANGES]]{...}` frame and the persisted `chat_messages.content` does NOT contain it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tool-loop.ts src/lib/thesis-history.ts src/routes/chat.ts
git commit -m "feat(history): MODK_DOCCHANGES turn-checkpoint frame for one-tap AI undo"
```

---

## Final verification

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npx vitest run` — full suite green.
- [ ] Manual ring check: make 25 quick edits to one thesis → `GET /:id/history` returns exactly 20 entries, oldest seqs pruned, and the Supabase `documents` bucket has no orphaned `.history/` objects older than the oldest row (spot-check).
- [ ] Memory-bank note + docs update happen after all three plans land (not per-plan).
