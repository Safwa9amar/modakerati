# Tasks — Reviewing Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The student opens the Writer, sees each proposed rewrite sitting on the real paragraph, and accepts or rejects it — with a pill counting them down so none is missed.

**Architecture:** Proposals are hydrated into the **existing** `suggestion-store.byIndex`, which `InlineSuggestion` already renders in both the outline layer and the Lexical editor. Nothing new draws a diff. A proposal carries its `proposalId`, so the existing `approve`/`reject` also report the outcome to the server; accepting flows through the durable op queue exactly like a manual edit. Anchors are re-resolved against the live document, and a miss marks the proposal stale rather than editing the wrong paragraph.

**Tech Stack:** Hono + Drizzle (server), Expo/React Native + Zustand (app), vitest (server only).

**Spec:** `docs/superpowers/specs/2026-08-15-ai-tasks-design.md` — "Reviewing happens in the document", "Bulk actions".
**Depends on:** phase 1 (server v1.15.0, deployed) and phase 2 (app, built).

---

## Why almost none of this draws UI

`InlineSuggestion` already renders a pending proposal on a block — original teaser, proposed text, ✓ Approve / ✕ Reject — and is mounted in two places (`OutlineReorderable.tsx:118` and the Lexical `SuggestionPlugin`). Both read `suggestion-store.byIndex`, keyed by block index.

So a `task_proposal` becomes reviewable by being **converted into a `PendingSuggestion`**. The only genuinely new UI is the stepper pill and three buttons on the report.

## File structure

**Server — create**

| File | Responsibility |
|---|---|
| `src/lib/tasks/proposals.ts` | Accept / reject / accept-all / reject-all / void, as pure-ish DB operations. |

**Server — modify**

- `src/routes/tasks.ts` — the proposal endpoints and run undo

**App — create**

| File | Responsibility |
|---|---|
| `components/workspace/ProposalStepper.tsx` | The counting-down pill. |

**App — modify**

- `lib/block-links.ts` — add `resolveBlockIndexStrict` (returns `null` on a miss)
- `lib/tasks-api.ts` — the new endpoints
- `stores/suggestion-store.ts` — `PendingSuggestion` gains `proposalId` / `runId`; `approve`/`reject` report back
- `stores/tasks-store.ts` — hydrate proposals into the suggestion store
- `app/(app)/thesis-workspace.tsx` — mount the stepper
- `app/(app)/task-run.tsx` — Review / Approve all / Reject all / Undo the run
- `locales/{en,fr,ar}.json` — **surgically**

---

## Task 1: Proposal operations (server)

**Files:**
- Create: `~/modakerati-server/src/lib/tasks/proposals.ts`
- Test: `~/modakerati-server/src/lib/tasks/__tests__/proposals.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/proposals.test.ts
import "dotenv/config";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, theses, taskRuns, tasks as taskTable, taskProposals } from "../../../db";
import { setProposalStatus, bulkSetPending, countPending } from "../proposals";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("proposal operations", () => {
  let thesisId: string, userId: string, runId: string, taskId: string;
  const madeRuns: string[] = [];

  beforeAll(async () => {
    const [t] = await db.select({ id: theses.id, userId: theses.userId }).from(theses).limit(1);
    if (!t) throw new Error("no thesis to attach a test run to");
    thesisId = t.id;
    userId = t.userId;
  });

  afterAll(async () => {
    for (const id of madeRuns) await db.delete(taskRuns).where(eq(taskRuns.id, id));
  });

  async function seed(n: number) {
    const [run] = await db.insert(taskRuns)
      .values({ userId, thesisId, status: "done" })
      .returning({ id: taskRuns.id });
    madeRuns.push(run.id);
    runId = run.id;
    const [task] = await db.insert(taskTable)
      .values({ runId, position: 0, kind: "proofread", params: {}, target: {}, mode: "propose", status: "done" })
      .returning({ id: taskTable.id });
    taskId = task.id;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const [p] = await db.insert(taskProposals)
        .values({
          taskId, thesisId,
          anchor: { index: i, snippet: `snippet ${i}` },
          beforeText: `before ${i}`, afterText: `after ${i}`, note: "why",
        })
        .returning({ id: taskProposals.id });
      ids.push(p.id);
    }
    return ids;
  }

  it("accepts one proposal and leaves the others pending", async () => {
    const [a, b] = await seed(2);
    await setProposalStatus(a, "accepted", userId);
    const [rowA] = await db.select().from(taskProposals).where(eq(taskProposals.id, a));
    const [rowB] = await db.select().from(taskProposals).where(eq(taskProposals.id, b));
    expect(rowA.status).toBe("accepted");
    expect(rowB.status).toBe("pending");
  });

  it("refuses to touch another user's proposal", async () => {
    const [a] = await seed(1);
    await expect(
      setProposalStatus(a, "accepted", "00000000-0000-0000-0000-0000000000ff"),
    ).rejects.toThrow();
  });

  it("never re-decides a proposal that was already decided", async () => {
    const [a] = await seed(1);
    await setProposalStatus(a, "accepted", userId);
    await setProposalStatus(a, "rejected", userId);
    const [row] = await db.select().from(taskProposals).where(eq(taskProposals.id, a));
    expect(row.status).toBe("accepted");
  });

  it("bulk-sets only the pending ones", async () => {
    const [a] = await seed(3);
    await setProposalStatus(a, "rejected", userId);
    const n = await bulkSetPending(runId, "accepted", userId);
    expect(n).toBe(2);
    expect(await countPending(runId)).toBe(0);
  });

  it("counts what is still waiting", async () => {
    await seed(2);
    expect(await countPending(runId)).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/proposals.test.ts`
Expected: FAIL — `Failed to resolve import "../proposals"`

- [ ] **Step 3: Write the operations**

```ts
// src/lib/tasks/proposals.ts
import { and, eq, inArray } from "drizzle-orm";
import { db, taskRuns, tasks as taskTable, taskProposals } from "../../db";

export type ProposalStatus = "accepted" | "rejected" | "stale";

/**
 * Decide one proposal.
 *
 * Ownership is checked by joining back to the run, not trusted from the caller:
 * a proposal id is a bare uuid in a URL, and nothing else would stop one student
 * from accepting a rewrite into another student's thesis.
 *
 * A proposal that was already decided is LEFT ALONE. The student may have tapped
 * twice, or the stepper and the report may both be open — either way, the first
 * decision is the real one and re-deciding it would silently flip an accepted
 * rewrite to rejected.
 */
export async function setProposalStatus(
  proposalId: string,
  status: ProposalStatus,
  userId: string,
): Promise<void> {
  const [owned] = await db
    .select({ id: taskProposals.id })
    .from(taskProposals)
    .innerJoin(taskTable, eq(taskTable.id, taskProposals.taskId))
    .innerJoin(taskRuns, eq(taskRuns.id, taskTable.runId))
    .where(and(eq(taskProposals.id, proposalId), eq(taskRuns.userId, userId)));
  if (!owned) throw new Error("proposal not found");

  await db
    .update(taskProposals)
    .set({ status })
    .where(and(eq(taskProposals.id, proposalId), eq(taskProposals.status, "pending")));
}

/** Decide every still-pending proposal in a run. Returns how many changed. */
export async function bulkSetPending(
  runId: string,
  status: ProposalStatus,
  userId: string,
): Promise<number> {
  const [run] = await db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId)));
  if (!run) throw new Error("run not found");

  const ids = await pendingIds(runId);
  if (!ids.length) return 0;
  await db.update(taskProposals).set({ status }).where(inArray(taskProposals.id, ids));
  return ids.length;
}

export async function countPending(runId: string): Promise<number> {
  return (await pendingIds(runId)).length;
}

async function pendingIds(runId: string): Promise<string[]> {
  const rows = await db
    .select({ id: taskProposals.id })
    .from(taskProposals)
    .innerJoin(taskTable, eq(taskTable.id, taskProposals.taskId))
    .where(and(eq(taskTable.runId, runId), eq(taskProposals.status, "pending")));
  return rows.map((r) => r.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/proposals.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/tasks/proposals.ts src/lib/tasks/__tests__/proposals.test.ts
git commit -m "feat(tasks): decide a proposal, with ownership checked by join

A proposal id is a bare uuid in a URL — ownership is re-derived through the
run rather than trusted. A proposal already decided is left alone, so a double
tap or two open screens cannot flip an accepted rewrite to rejected."
```

---

## Task 2: Proposal endpoints (server)

**Files:**
- Modify: `~/modakerati-server/src/routes/tasks.ts`

- [ ] **Step 1: Add the endpoints**

Append to `src/routes/tasks.ts`, and extend the existing drizzle import with `desc` if it is not already there:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Reviewing proposals (phase 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every proposal still waiting on this thesis, newest run first.
 *
 * Scoped to the THESIS, not one run: the student opens the Writer and wants to
 * see everything outstanding on the page in front of them, whichever run
 * produced it.
 */
taskRoutes.get("/proposals", async (c) => {
  const userId = c.get("userId");
  const thesisId = c.req.query("thesisId");
  if (!thesisId) return c.json({ error: "thesisId required" }, 400);

  const rows = await db
    .select({
      id: taskProposals.id,
      taskId: taskProposals.taskId,
      runId: taskTable.runId,
      anchor: taskProposals.anchor,
      beforeText: taskProposals.beforeText,
      afterText: taskProposals.afterText,
      note: taskProposals.note,
      status: taskProposals.status,
    })
    .from(taskProposals)
    .innerJoin(taskTable, eq(taskTable.id, taskProposals.taskId))
    .innerJoin(taskRuns, eq(taskRuns.id, taskTable.runId))
    .where(
      and(
        eq(taskProposals.thesisId, thesisId),
        eq(taskRuns.userId, userId),
        eq(taskProposals.status, "pending"),
      ),
    );

  return c.json({ proposals: rows });
});

taskRoutes.post("/proposals/:proposalId/:decision", async (c) => {
  const userId = c.get("userId");
  const decision = c.req.param("decision");
  if (decision !== "accept" && decision !== "reject" && decision !== "stale") {
    return c.json({ error: "decision must be accept, reject or stale" }, 400);
  }
  const status = decision === "accept" ? "accepted" : decision === "reject" ? "rejected" : "stale";
  try {
    await setProposalStatus(c.req.param("proposalId"), status, userId);
  } catch {
    return c.json({ error: "not found" }, 404);
  }
  return c.json({ ok: true });
});

taskRoutes.post("/runs/:runId/proposals/:decision", async (c) => {
  const userId = c.get("userId");
  const decision = c.req.param("decision");
  if (decision !== "accept" && decision !== "reject") {
    return c.json({ error: "decision must be accept or reject" }, 400);
  }
  try {
    const changed = await bulkSetPending(
      c.req.param("runId"),
      decision === "accept" ? "accepted" : "rejected",
      userId,
    );
    return c.json({ changed });
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

/**
 * Undo the whole run: restore the .docx to the checkpoint taken before the first
 * task ran, and void anything still pending.
 *
 * This rolls back applied tasks AND any proposals the student already accepted,
 * because once accepted those are ordinary document text with nothing marking
 * them apart. The app states that before asking.
 */
taskRoutes.post("/runs/:runId/undo", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");

  const [run] = await db
    .select()
    .from(taskRuns)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId)));
  if (!run) return c.json({ error: "not found" }, 404);
  if (run.historyCheckpoint == null) return c.json({ error: "this run has no checkpoint" }, 409);
  if (run.status === "running" || run.status === "cancelling") {
    return c.json({ error: "cancel the run before undoing it" }, 409);
  }

  const { ownedLiveThesis } = await import("./thesis-history");
  const found = await ownedLiveThesis(userId, run.thesisId);
  if (!found) return c.json({ error: "thesis not found" }, 404);

  const { restoreThesisToSeq } = await import("../lib/thesis-history");
  await withThesisLock(run.thesisId, () => restoreThesisToSeq(found, run.historyCheckpoint!));

  // Pending proposals describe paragraphs that no longer exist as the AI saw
  // them. Void rather than leave them to apply against restored text.
  await bulkSetPending(runId, "stale", userId);

  return c.json({ ok: true });
});
```

Add to the imports at the top of the file:

```ts
import { setProposalStatus, bulkSetPending } from "../lib/tasks/proposals";
import { withThesisLock } from "../lib/thesis-lock";
```

- [ ] **Step 2: Reconcile the two names this leans on**

`ownedLiveThesis` and `restoreThesisToSeq` are used by `src/routes/thesis-history.ts:11,64`. Confirm both are exported and what `restoreThesisToSeq` takes:

```bash
cd ~/modakerati-server
grep -n "export .*ownedLiveThesis" -r src/
grep -n "export async function restoreThesisToSeq" -A 4 src/lib/thesis-history.ts
```

If `ownedLiveThesis` is not exported from `thesis-history.ts`, export it there (it is a lookup, not a route) and import it normally rather than with a dynamic import. Match the real signature of `restoreThesisToSeq` — do not adapt the call to the plan.

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati-server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Prove the endpoints answer**

```bash
cd ~/modakerati-server && npm run dev &
sleep 10
curl -s -o /dev/null -w "GET /api/tasks/proposals → %{http_code}\n" "http://localhost:3000/api/tasks/proposals?thesisId=x"
curl -s -o /dev/null -w "POST bad decision → %{http_code}\n" -X POST "http://localhost:3000/api/tasks/proposals/abc/frobnicate"
```

Expected: both `401` (no session). A `404` on the first means the route did not register — check it was added inside `taskRoutes` and above no catch-all.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/routes/tasks.ts
git commit -m "feat(tasks): proposal endpoints and run undo

Proposals list by THESIS, not by run: the student is looking at a page and
wants everything outstanding on it. Undo restores the pre-run checkpoint and
voids anything still pending, because those describe paragraphs that no longer
exist as the AI saw them."
```

---

## Task 3: A strict anchor resolver (app)

`resolveBlockIndex` never fails — it falls back to the original index. That is right for a chat deep link (scrolling somewhere near is better than nothing) and **wrong** for a proposal, where the fallback would apply a rewrite to whatever paragraph now sits at that number.

**Files:**
- Modify: `lib/block-links.ts`

- [ ] **Step 1: Add the strict variant**

Append to `lib/block-links.ts`, reusing the module's existing `normalize` and `blockSearchText`:

```ts
/**
 * Like resolveBlockIndex, but returns null rather than guessing.
 *
 * resolveBlockIndex falls back to the requested index when the text cannot be
 * found, which is correct for a deep link — landing near the right place beats
 * doing nothing. It is exactly wrong for a scheduled proposal: the fallback
 * would apply a rewrite to whatever paragraph now happens to sit at that
 * number. A miss here must mark the proposal stale instead.
 */
export function resolveBlockIndexStrict(
  blocks: DocBlockDTO[] | undefined,
  index: number,
  snippet: string,
): number | null {
  if (!blocks?.length) return null;
  const needle = normalize(snippet).slice(0, LABEL_HEAD).trim();
  if (needle.length < MIN_LABEL) return null;

  const max = blocks.length - 1;
  const textAt = (i: number) => normalize(blockSearchText(blocks[i] ?? ({} as DocBlockDTO)));

  // Index AND text agreeing is the strongest evidence available; a duplicate
  // elsewhere does not weaken it.
  if (index >= 0 && index <= max && textAt(index).includes(needle)) return index;

  const hits: number[] = [];
  for (let i = 0; i <= max; i++) if (textAt(i).includes(needle)) hits.push(i);
  // Only the fallback search can be ambiguous — the hint has already failed, so
  // nothing is left to break a tie.
  return hits.length === 1 ? hits[0] : null;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no new errors. `LABEL_HEAD`, `MIN_LABEL`, `normalize` and `blockSearchText` are already module-private in this file; if any is named differently, use the real name rather than adding a duplicate.

- [ ] **Step 3: Check the rule by hand**

```bash
cd ~/modakerati && npx tsx -e '
import { resolveBlockIndexStrict } from "./lib/block-links";
const doc = (...t: string[]) => t.map((text, index) => ({ index, kind: "paragraph", text })) as any;
console.log("exact hit          :", resolveBlockIndexStrict(doc("a","b","المنهج المتبع في الدراسة"), 2, "المنهج المتبع في الدراسة"));
console.log("moved down         :", resolveBlockIndexStrict(doc("x","y","z","المنهج المتبع في الدراسة"), 2, "المنهج المتبع في الدراسة"));
console.log("gone (expect null) :", resolveBlockIndexStrict(doc("a","b"), 2, "المنهج المتبع في الدراسة"));
console.log("ambiguous (null)   :", resolveBlockIndexStrict(doc("المنهج المتبع في الدراسة","x","y","المنهج المتبع في الدراسة"), 9, "المنهج المتبع في الدراسة"));
'
```

Expected: `2`, `3`, `null`, `null`.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add lib/block-links.ts
git commit -m "feat(tasks): a strict block resolver that can say 'not found'

resolveBlockIndex falls back to the requested index, which is right for a deep
link and exactly wrong for a proposal — the fallback would apply a rewrite to
whatever paragraph now sits at that number."
```

---

## Task 4: The client for the new endpoints

**Files:**
- Modify: `lib/tasks-api.ts`

- [ ] **Step 1: Add the calls**

Append to `lib/tasks-api.ts`:

```ts
/** A proposal as the review flow needs it — with the run it came from. */
export interface PendingProposal {
  id: string;
  taskId: string;
  runId: string;
  anchor: { index: number; snippet: string; label?: string };
  beforeText: string;
  afterText: string;
  note: string;
  status: "pending";
}

/** Everything still waiting on this thesis, whichever run produced it. */
export async function listPendingProposals(thesisId: string): Promise<PendingProposal[]> {
  const r = await apiGet<{ proposals: PendingProposal[] }>(
    `/api/tasks/proposals?thesisId=${encodeURIComponent(thesisId)}`,
  );
  return r.proposals;
}

export async function decideProposal(
  proposalId: string,
  decision: "accept" | "reject" | "stale",
): Promise<void> {
  await apiPost(`/api/tasks/proposals/${proposalId}/${decision}`, {});
}

/**
 * Decide every still-pending proposal in a run, server-side. Returns how many
 * changed.
 *
 * Used for REJECT ALL. Accept-all deliberately does not go through here — see
 * tasks-store.approveAllPending: marking rows accepted without applying them
 * would leave the student told "approved" over untouched text.
 */
export async function decideAllProposals(
  runId: string,
  decision: "accept" | "reject",
): Promise<number> {
  const r = await apiPost<{ changed: number }>(`/api/tasks/runs/${runId}/proposals/${decision}`, {});
  return r.changed;
}

/** Restore the document to the checkpoint taken before this run started. */
export async function undoRun(runId: string): Promise<void> {
  await apiPost(`/api/tasks/runs/${runId}/undo`, {});
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add lib/tasks-api.ts
git commit -m "feat(tasks): client for reviewing proposals"
```

---

## Task 5: Carry a proposal through the existing suggestion store

This is the whole trick: a `task_proposal` becomes a `PendingSuggestion`, and `InlineSuggestion` renders it with no changes at all.

**Files:**
- Modify: `stores/suggestion-store.ts`

- [ ] **Step 1: Let a suggestion remember it came from a task**

In `stores/suggestion-store.ts`, add to the `PendingSuggestion` interface, beside `label`:

```ts
  /**
   * Set when this card came from a scheduled task's proposal rather than a live
   * ask. Approve/reject then also tell the server what the student decided —
   * without it the row would sit "pending" for ever and the Needs-you band
   * would never clear.
   */
  proposalId?: string;
  /** The run that produced it, for the stepper's "N of M". */
  runId?: string;
```

- [ ] **Step 2: Report the decision on approve and reject**

Still in `stores/suggestion-store.ts`, at the very top of `approve`, after `const cur = get().byIndex[index];` and its guard, add:

```ts
    // A task proposal is decided server-side too. Fire-and-forget: the document
    // edit below is the part that must not be blocked on a network round trip,
    // and a lost status update only means the card can reappear — never that
    // the wrong text lands.
    if (cur.proposalId) void decideProposal(cur.proposalId, "accept").catch(() => {});
```

and replace `reject` entirely with:

```ts
  reject: (index) => {
    const cur = get().byIndex[index];
    if (cur?.proposalId) void decideProposal(cur.proposalId, "reject").catch(() => {});
    set((s) => ({ byIndex: without(s.byIndex, index) }));
  },
```

Add the import at the top of the file:

```ts
import { decideProposal } from "@/lib/tasks-api";
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add stores/suggestion-store.ts
git commit -m "feat(tasks): a suggestion can carry the proposal it came from

Approve/reject then report the decision server-side, so the row stops being
pending and the Needs-you band clears. Fire-and-forget on purpose: the document
edit must not wait on a round trip, and a lost status update only means the
card can reappear — never that the wrong text lands."
```

---

## Task 6: Hydrate proposals onto the page

**Files:**
- Modify: `stores/tasks-store.ts`

- [ ] **Step 1: Add the hydrator**

Add to `TasksState` in `stores/tasks-store.ts`:

```ts
  /**
   * Put every pending proposal for this thesis onto its paragraph, as an
   * ordinary inline suggestion. Returns how many are now showing.
   */
  hydrateProposals: (thesisId: string) => Promise<number>;
```

and to the store body:

```ts
  hydrateProposals: async (thesisId) => {
    let pending: Awaited<ReturnType<typeof listPendingProposals>>;
    try {
      pending = await listPendingProposals(thesisId);
    } catch {
      return 0;
    }
    if (!pending.length) return 0;

    const blocks = useThesisDocStore.getState().byId[thesisId]?.blocks;
    const cards: Record<number, PendingSuggestion> = {};
    let shown = 0;

    for (const p of pending) {
      // Re-resolved against the LIVE document: the run happened hours ago and
      // the student may have edited since.
      const at = resolveBlockIndexStrict(blocks, p.anchor.index, p.anchor.snippet || p.beforeText);
      if (at === null) {
        // Do not guess, and do not leave it pending for ever — void it so the
        // Needs-you band can empty and the student is not chasing a ghost.
        void decideProposal(p.id, "stale").catch(() => {});
        continue;
      }
      // Two proposals on one paragraph cannot both be shown (byIndex is keyed by
      // block). Keep the first; the second stays pending for the next pass.
      if (cards[at]) continue;

      cards[at] = {
        index: at,
        original: p.beforeText,
        proposed: p.afterText,
        instruction: p.note,
        status: "ready",
        action: "rewrite",
        label: i18n.t("tasks.proposedRewrite", { defaultValue: "Proposed rewrite" }),
        proposalId: p.id,
        runId: p.runId,
      };
      shown++;
    }

    if (shown > 0) {
      useSuggestionStore.setState((s) => ({ byIndex: { ...s.byIndex, ...cards } }));
    }
    return shown;
  },
```

with these imports added at the top of `stores/tasks-store.ts`:

```ts
import i18n from "@/lib/i18n";
import { listPendingProposals, decideProposal } from "@/lib/tasks-api";
import { resolveBlockIndexStrict } from "@/lib/block-links";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSuggestionStore, type PendingSuggestion } from "@/stores/suggestion-store";
```

- [ ] **Step 1b: Add approve-all, which must actually apply the text**

Also add to `TasksState`:

```ts
  /** Hydrate, then approve every pending proposal. Returns how many applied. */
  approveAllPending: (thesisId: string) => Promise<number>;
```

and to the body:

```ts
  approveAllPending: async (thesisId) => {
    // Hydrate FIRST. Marking the rows accepted server-side would drop them out
    // of the pending list this reads from, and the document would never change
    // — the student would be told "approved" over untouched text.
    await get().hydrateProposals(thesisId);
    const cards = Object.values(useSuggestionStore.getState().byIndex).filter((c) => !!c.proposalId);
    // Descending: approve() dispatches an editText per block, and working from
    // the end means an insertion or deletion cannot shift a block this loop has
    // not reached yet.
    for (const card of cards.sort((a, b) => b.index - a.index)) {
      useSuggestionStore.getState().approve(thesisId, card.index);
    }
    return cards.length;
  },
```

- [ ] **Step 2: Confirm the two shapes this reaches into**

```bash
cd ~/modakerati
grep -n "byId\b" stores/thesis-doc-store.ts | head -3
grep -n "export const useSuggestionStore" stores/suggestion-store.ts
```

The document store must expose blocks at `byId[thesisId].blocks`, and the suggestion store must be exported under that name. Use whatever the files really say.

- [ ] **Step 3: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add stores/tasks-store.ts
git commit -m "feat(tasks): put pending proposals onto their paragraphs

Anchors are re-resolved against the LIVE document — the run happened hours ago.
A miss is voided rather than guessed, so the Needs-you band can empty instead
of leaving the student chasing a paragraph that no longer exists."
```

---

## Task 7: The stepper pill

**Files:**
- Create: `components/workspace/ProposalStepper.tsx`

- [ ] **Step 1: Write it**

```tsx
// components/workspace/ProposalStepper.tsx
import { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useEditorScrollStore } from "@/stores/editor-scroll-store";
import { ChevronRight } from "lucide-react-native";

/**
 * Counts the proposals from a scheduled run down to zero and jumps to the next
 * one, so none is missed by scrolling past it. Renders nothing when there are
 * none — this is the only thing that says "you still have work waiting" while
 * the student is in the document.
 *
 * Deliberately does NOT hold its own list: it reads the same byIndex the cards
 * render from, so accepting a card anywhere updates the count for free.
 */
export function ProposalStepper({ onJump }: { onJump: (index: number) => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { flexDirection } = useRTL();
  const byIndex = useSuggestionStore((s) => s.byIndex);

  // Only cards that came from a task — a live "ask the AI to rewrite this" card
  // is not part of a run and must not be counted into it.
  const indices = useMemo(
    () =>
      Object.values(byIndex)
        .filter((c) => !!c.proposalId)
        .map((c) => c.index)
        .sort((a, b) => a - b),
    [byIndex],
  );

  if (indices.length === 0) return null;

  return (
    <View style={[styles.pill, { flexDirection, backgroundColor: colors.bgCard, borderColor: colors.semanticWarning }]}>
      <Text style={[styles.count, { color: colors.semanticWarning }]}>{indices.length}</Text>
      <Text style={[styles.label, { color: colors.textPrimary }]} numberOfLines={1}>
        {t("tasks.waitingForYou")}
      </Text>
      <Pressable
        onPress={() => onJump(indices[0])}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t("tasks.reviewNext")}
        style={[styles.next, { borderColor: colors.borderDefault }]}
      >
        <Text style={{ color: colors.brandPrimary, fontSize: 12, fontWeight: "600" }}>
          {t("tasks.reviewNext")}
        </Text>
        <ChevronRight size={14} color={colors.brandPrimary} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute", left: 12, right: 12, bottom: 12,
    alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: 24, borderWidth: 1,
    shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  count: { fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] },
  label: { fontSize: 13, flex: 1 },
  next: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
});
```

- [ ] **Step 2: Confirm the scroll store's jump API**

```bash
cd ~/modakerati && grep -n "export" stores/editor-scroll-store.ts | head -8
```

The stepper takes `onJump` as a prop rather than calling the store itself, so this step is only to know what the workspace should pass in Task 8. If there is no block-scroll action, pass a handler that sets the workspace's selected block instead — the document will bring it into view.

- [ ] **Step 3: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add components/workspace/ProposalStepper.tsx
git commit -m "feat(tasks): the proposal stepper

Reads the same byIndex the cards render from, so accepting one anywhere
updates the count for free. Counts only task proposals — a live rewrite ask is
not part of a run."
```

---

## Task 8: Mount the review in the Writer

**Files:**
- Modify: `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1: Hydrate on entry and mount the pill**

In `app/(app)/thesis-workspace.tsx`, add the imports:

```tsx
import { ProposalStepper } from "@/components/workspace/ProposalStepper";
```

Beside the existing live-run watcher effect (the one that calls `watchLive`), add:

```tsx
  // Bring any waiting proposals onto the page when the Writer opens, and again
  // whenever a run finishes — that is exactly when new ones appear.
  useEffect(() => {
    if (!thesisId) return;
    void useTasksStore.getState().hydrateProposals(thesisId);
  }, [thesisId, liveRunId]);
```

and render the pill as the last child of the screen's root view, after the running banner:

```tsx
      <ProposalStepper
        onJump={(index) => {
          useWorkspaceStore.getState().selectBlock(index, "");
        }}
      />
```

- [ ] **Step 2: Confirm the selection call**

```bash
cd ~/modakerati && grep -n "selectBlock" stores/workspace-store.ts | head -3
```

`selectBlock(index, text)` is what `BlockContextBar`'s `onSelect` uses (`app/(app)/thesis-workspace.tsx:723`). Match its real signature; if it needs the block's text, read it from `useThesisDocStore.getState().byId[thesisId]?.blocks[index]?.text ?? ""`.

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: See it work**

With the server running and a thesis that has a finished propose-mode run:

1. Open the Writer → within a moment the proposed paragraph shows the inline card, and the pill reads the number waiting.
2. Tap ✓ Approve on the card → the paragraph takes the new text, the pill's count drops by one.
3. Reopen Tasks → the run's "Needs you" entry has dropped by one too.
4. Tap ✕ on another → it disappears and does **not** come back on reopening the Writer.

Step 3 is the one that proves the server round trip; if the count never drops, the decide call is failing silently — check the network log.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati
git add "app/(app)/thesis-workspace.tsx"
git commit -m "feat(tasks): review proposals in the Writer

Hydrated on entry and whenever a run finishes, which is exactly when new ones
appear. A rewrite is only judgeable with the page around it."
```

---

## Task 9: The report's three actions

**Files:**
- Modify: `app/(app)/task-run.tsx`

- [ ] **Step 1: Add Review, Approve all / Reject all, and Undo**

In `app/(app)/task-run.tsx`, add the imports:

```tsx
import { Alert } from "react-native";
import { decideAllProposals, undoRun } from "@/lib/tasks-api";
import { useTasksStore } from "@/stores/tasks-store";
```

Add, beside the screen's other state:

```tsx
  const router = useRouter();   // add useRouter to the expo-router import
  const [working, setWorking] = useState(false);
```

and render, directly above the existing Cancel button:

```tsx
        {pending > 0 ? (
          <>
            {/* The report counts; the document reviews. Tapping through is the
                whole point — a rewrite is only judgeable in context. */}
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/(app)/thesis-workspace",
                  params: { thesisId: run!.thesisId },
                } as any)
              }
              style={[styles.review, { backgroundColor: colors.brandPrimary }]}
            >
              <Text style={{ color: colors.brandOnPrimary, fontWeight: "600" }}>
                {t("tasks.reviewInDocument", { count: pending })}
              </Text>
            </Pressable>

            <View style={[styles.bulkRow, { flexDirection }]}>
              <Pressable
                disabled={working}
                onPress={async () => {
                  setWorking(true);
                  try {
                    await decideAllProposals(run!.id, "reject");
                    await fetchRun();
                  } finally {
                    setWorking(false);
                  }
                }}
                style={[styles.bulk, { borderColor: colors.borderDefault }]}
              >
                <Text style={{ color: colors.textSecondary, fontSize: 13 }}>{t("tasks.rejectAll")}</Text>
              </Pressable>

              {/* Approve all must APPLY the text, not just mark the rows
                  accepted. Marking them accepted server-side would drop them out
                  of the pending list the Writer hydrates from — the student
                  would see "approved" and the document would never change.
                  So it hydrates and approves each through the same op queue a
                  manual edit uses. */}
              <Pressable
                disabled={working}
                onPress={async () => {
                  setWorking(true);
                  try {
                    await useTasksStore.getState().approveAllPending(run!.thesisId);
                    await fetchRun();
                  } finally {
                    setWorking(false);
                  }
                }}
                style={[styles.bulk, { borderColor: colors.semanticSuccess }]}
              >
                <Text style={{ color: colors.semanticSuccess, fontSize: 13 }}>{t("tasks.approveAll")}</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {run && run.status === "done" ? (
          <Pressable
            disabled={working}
            onPress={() => {
              // Undo takes back MORE than this run's own edits if the student
              // has already accepted proposals — those are ordinary text now.
              // Say so before they tap, not after.
              Alert.alert(t("tasks.undoTitle"), t("tasks.undoBody"), [
                { text: t("common.cancel", { defaultValue: "Cancel" }), style: "cancel" },
                {
                  text: t("tasks.undoConfirm"),
                  style: "destructive",
                  onPress: async () => {
                    setWorking(true);
                    try {
                      await undoRun(run.id);
                      await useThesisDocStore.getState().revalidate(run.thesisId);
                      await fetchRun();
                    } finally {
                      setWorking(false);
                    }
                  },
                },
              ]);
            }}
            style={[styles.undo, { borderColor: colors.semanticError }]}
          >
            <Text style={{ color: colors.semanticError, fontWeight: "600" }}>{t("tasks.undoRun")}</Text>
          </Pressable>
        ) : null}
```

Add `import { useThesisDocStore } from "@/stores/thesis-doc-store";` and these styles:

```tsx
  review: { paddingVertical: 14, borderRadius: 12, alignItems: "center", marginTop: 6 },
  bulkRow: { gap: 8, marginTop: 8 },
  bulk: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  undo: { marginTop: 18, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add "app/(app)/task-run.tsx"
git commit -m "feat(tasks): review, approve all / reject all, and undo the run

Approve all marks them accepted; the text lands when the Writer hydrates them.
Applying N rewrites from a screen showing none of them is not something to do
behind the student's back.

Undo warns first: it takes back more than the run's own edits once proposals
have been accepted, because those are ordinary document text by then."
```

---

## Task 10: The strings

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Insert into each file**

⚠️ **Never** `json.load`/`json.dump` these — ~155 duplicate keys per file, and a round-trip drops them silently. Insert line-wise against an anchor, then verify insertions-only.

Insert immediately **before** the line `    "when": {` inside the existing `tasks` object.

`locales/en.json`:

```json
    "proposedRewrite": "Proposed rewrite",
    "reviewNext": "Review",
    "reviewInDocument": "Review {{count}} in the document",
    "approveAll": "Approve all",
    "rejectAll": "Reject all",
    "undoRun": "Undo this run",
    "undoTitle": "Undo this run?",
    "undoBody": "The document goes back to how it was before this run started. Anything you already approved from it goes back too.",
    "undoConfirm": "Undo",
```

`locales/fr.json`:

```json
    "proposedRewrite": "Réécriture proposée",
    "reviewNext": "Examiner",
    "reviewInDocument": "Examiner {{count}} dans le document",
    "approveAll": "Tout accepter",
    "rejectAll": "Tout refuser",
    "undoRun": "Annuler cette exécution",
    "undoTitle": "Annuler cette exécution ?",
    "undoBody": "Le document revient à son état d'avant. Ce que vous avez déjà accepté sera aussi annulé.",
    "undoConfirm": "Annuler",
```

`locales/ar.json`:

```json
    "proposedRewrite": "إعادة صياغة مقترحة",
    "reviewNext": "مراجعة",
    "reviewInDocument": "راجع {{count}} في المستند",
    "approveAll": "قبول الكل",
    "rejectAll": "رفض الكل",
    "undoRun": "التراجع عن هذا التنفيذ",
    "undoTitle": "التراجع عن هذا التنفيذ؟",
    "undoBody": "سيعود المستند إلى ما كان عليه قبل التنفيذ، وسيُلغى أيضًا ما قبلته منه.",
    "undoConfirm": "تراجع",
```

- [ ] **Step 2: Verify insertions only**

```bash
cd ~/modakerati
for f in en fr ar; do node -e "const o=JSON.parse(require('fs').readFileSync('locales/$f.json','utf8')); console.log('$f', o.tasks.approveAll)"; done
git diff --numstat locales/
```

Expected: all three print, and the diff shows **9 insertions, 0 deletions** per file. Any deletion means a round-trip happened — `git checkout locales/` and redo it line-wise.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(tasks): strings for reviewing proposals"
```

---

## Task 11: Final pass

- [ ] **Step 1: Server suite**

Run: `cd ~/modakerati-server && npx vitest run --testTimeout=60000`
Expected: all pass. A timeout is not a failure until re-run with that flag.

- [ ] **Step 2: App gates**

```bash
cd ~/modakerati
npx tsc --noEmit
node scripts/verify-use-dom.mjs
```

Expected: both clean.

- [ ] **Step 3: Walk the whole loop on a device**

1. Queue `remove_repetition` in **propose** mode on a chapter with obvious repetition; **Run now**.
2. When it finishes, Tasks shows "N waiting for you".
3. Open the report → tap **Review in the document** → the Writer opens with the card on the real paragraph and the pill showing the count.
4. **Approve** one — the paragraph takes the new text.
5. **Reject** one — it disappears and stays gone after leaving and re-entering the Writer.
6. Back in the report, tap **Undo this run** → confirm the warning names what it takes back → the document returns to its pre-run state.
7. Reopen the Writer: no ghost cards, and the pill is gone.

Step 5 and step 7 are the ones that catch a decide call failing silently.

- [ ] **Step 4: Commit anything outstanding**

```bash
cd ~/modakerati && git status --porcelain
cd ~/modakerati-server && git status --porcelain
```

Expected: both clean.

---

## Done when

- The server suite passes; `tsc --noEmit` and the use-dom gate pass in the app
- A propose-mode run's rewrites appear on their real paragraphs, and approving one changes the document
- A rejected proposal does not come back
- Undo restores the document and clears the pill
- An anchored proposal whose paragraph was deleted between the run and the review is voided, not applied somewhere else

## A deliberate deviation from the spec

The spec puts *Approve all / Reject all* "from either the report or the
stepper". They are on the **report only**. The pill is a one-line overlay whose
whole job is "N left, next one here"; a bulk control on it is both cramped and
the wrong weight — approving a dozen rewrites is a sit-down decision, and the
report is one tap away. Flagged rather than silently dropped.

## Not in this change

Chat-side scheduling (`2026-08-15-tasks-from-chat-design.md`) and any per-task undo. Undo remains per run, which is why the risky job families default to propose mode in the first place.
