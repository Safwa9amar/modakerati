# Tasks — Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student's task list runs on the server at a scheduled time with no app connected, applies what it can, parks rewrites as reviewable proposals, and sends one push when it's done.

**Architecture:** Three tables hold runs, tasks and proposals. An external cron pings an authed `/api/tasks/tick`; the server claims due runs with a guarded UPDATE + lease, then executes each run inside `withThesisLock` — one History snapshot for the whole run, then one bounded `chatWithTools` call per task, each restricted to the tool set its job declares. Apply-mode tasks commit; propose-mode tasks get the writers stripped and a `propose_edit` tool that writes rows instead.

**Tech Stack:** Hono, Drizzle (hand-written SQL migrations — drizzle-kit is unusable in this project), Postgres/Supabase, vitest.

**Spec:** `docs/superpowers/specs/2026-08-15-ai-tasks-design.md`

**All paths below are in `~/modakerati-server` unless stated otherwise.**

---

## File structure

**Create**

| File | Responsibility |
|---|---|
| `src/lib/tasks/catalogue.ts` | Pure. Job definitions: family, default mode, declared read/write tools, params, instruction text. No IO. |
| `src/lib/tasks/anchor.ts` | Pure. Re-resolve a block anchor against a drifted document. No IO. |
| `src/lib/tasks/task-context.ts` | An AsyncLocalStorage carrying the running task's id, so `propose_edit` knows which task it belongs to. |
| `src/lib/tasks/claim.ts` | The guarded claim/lease/finish queries. |
| `src/lib/tasks/executor.ts` | Executes one run. Dependencies injected, so it unit-tests with no DB. |
| `src/db/tasks-schema.ts` | The three tables. |
| `sql/2026-08-15-tasks.sql` | The migration that actually creates them. |
| `src/mcp/tools/tasks.ts` | The `propose_edit` tool. |
| `src/routes/tasks.ts` | `/tick` + run/task CRUD. |
| `src/lib/tasks/__tests__/*.test.ts` | Tests. |

**Modify**

- `src/db/index.ts` — re-export the new tables
- `src/lib/ai/mcp-bridge.ts:713` — add `allowTools` to `connectMcpToolset`
- `src/lib/ai/tool-loop.ts:885,1720` — thread `allowTools` through `runTurn` and `chatWithTools`
- `src/lib/notifications.ts:7` — add the `tasks_complete` notification type
- `src/index.ts:117` — mount the route

**Why `catalogue.ts` and `anchor.ts` are pure:** every other module here needs Postgres, Supabase storage and the MCP bridge at import time. Keeping the two modules that hold the actual rules IO-free means their tests are real unit tests, the way `destructive-gate.ts` was split from `destructive-gate-io.ts`.

---

## Task 1: The job catalogue

Pure module. Each job declares the tools it may use, split into reads (always available) and writes (apply mode only). In propose mode the writes are dropped and `propose_edit` is added — that single rule is what makes "propose mode mutates nothing" structural rather than a promise.

**Files:**
- Create: `src/lib/tasks/catalogue.ts`
- Test: `src/lib/tasks/__tests__/catalogue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/catalogue.test.ts
import { describe, expect, it } from "vitest";
import { JOBS, jobById, toolsFor, defaultModeFor, type JobId } from "../catalogue";

describe("job catalogue", () => {
  it("gives every job a family default mode", () => {
    expect(defaultModeFor("fix_captions")).toBe("apply");
    expect(defaultModeFor("rebuild_toc")).toBe("apply");
    expect(defaultModeFor("apply_norms")).toBe("apply");
    expect(defaultModeFor("proofread")).toBe("propose");
    expect(defaultModeFor("draft_section")).toBe("propose");
    expect(defaultModeFor("custom_block_task")).toBe("propose");
  });

  it("drops every writer and adds propose_edit in propose mode", () => {
    for (const job of JOBS) {
      const proposeTools = toolsFor(job.id, "propose");
      expect(proposeTools).toContain("propose_edit");
      for (const writer of job.writes) {
        expect(proposeTools).not.toContain(writer);
      }
    }
  });

  it("never exposes propose_edit in apply mode", () => {
    for (const job of JOBS) {
      expect(toolsFor(job.id, "apply")).not.toContain("propose_edit");
    }
  });

  it("never hands a job load_tools — a run's tool set is fixed before it starts", () => {
    for (const job of JOBS) {
      expect(toolsFor(job.id, "apply")).not.toContain("load_tools");
      expect(toolsFor(job.id, "propose")).not.toContain("load_tools");
    }
  });

  it("builds an instruction that names the target", () => {
    const job = jobById("proofread" as JobId);
    const text = job.instruction({ scope: "الفصل الثاني" });
    expect(text).toContain("الفصل الثاني");
  });

  it("has no duplicate job ids", () => {
    const ids = JOBS.map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/catalogue.test.ts`
Expected: FAIL — `Failed to resolve import "../catalogue"`

- [ ] **Step 3: Write the catalogue**

```ts
// src/lib/tasks/catalogue.ts
/**
 * The job menu. A task is a job id plus params — never a free-form prompt,
 * except `custom_block_task`, whose scope is pinned to a block the student
 * selected, which is what makes free text safe there.
 *
 * WHY EACH JOB DECLARES ITS TOOLS
 * -------------------------------
 * A run executes with nobody watching, so the destructive-tool gate is
 * pre-satisfied (queueing the task IS the authorization). The containment that
 * replaces it is this list: the toolset is built with exactly these names and
 * nothing else is reachable — including `load_tools`, so the tool set cannot
 * grow mid-run. That also keeps the prompt-cache prefix stable, since a
 * mid-turn tool change rewrites the whole thing.
 *
 * PURE MODULE — no DB, no Supabase, no MCP. Keep it that way so its tests stay
 * real unit tests (same split as destructive-gate.ts / destructive-gate-io.ts).
 */

export type TaskFamily = "hygiene" | "formatting" | "language" | "content";
export type TaskMode = "apply" | "propose";

/** Reading the document is never a mutation, so every job gets these. */
const BASE_READS = ["read_thesis_blocks", "get_thesis_outline", "find_blocks"] as const;

export interface JobDef {
  id: string;
  family: TaskFamily;
  /** Tools available in BOTH modes. Must not mutate the document. */
  reads: string[];
  /** Tools available in apply mode only. */
  writes: string[];
  /** Params the caller must supply; `scope` is a human label, not an index. */
  params: readonly string[];
  /** The user message the turn runs on. */
  instruction: (p: Record<string, string>) => string;
}

const FAMILY_DEFAULT_MODE: Record<TaskFamily, TaskMode> = {
  hygiene: "apply",
  formatting: "apply",
  language: "propose",
  content: "propose",
};

export const JOBS: JobDef[] = [
  {
    id: "fix_captions",
    family: "hygiene",
    reads: [...BASE_READS, "list_captions"],
    writes: ["convert_text_captions_to_real_captions", "insert_caption"],
    params: [],
    instruction: () =>
      "Find every caption that was typed as ordinary text under a figure or table and turn it into a real caption, then make sure the numbering runs in order. Leave the wording exactly as the student wrote it.",
  },
  {
    id: "rebuild_toc",
    family: "hygiene",
    reads: [...BASE_READS],
    writes: ["insert_table_of_contents", "remove_table_of_contents"],
    params: [],
    instruction: () =>
      "Make sure the thesis has one correct table of contents in the right place, reflecting the current headings. If there is already a generated one, refresh it rather than adding a second.",
  },
  {
    id: "build_figure_and_table_lists",
    family: "hygiene",
    reads: [...BASE_READS, "list_captions"],
    writes: ["insert_caption_list"],
    params: [],
    instruction: () =>
      "Build the list of figures and the list of tables from the captions in the document, and place them where the thesis expects them.",
  },
  {
    id: "apply_norms",
    family: "formatting",
    reads: [...BASE_READS, "get_sections", "get_text_style"],
    writes: ["make_thesis_ready", "set_page_layout", "set_text_style"],
    params: ["normProfile"],
    instruction: (p) =>
      `Bring the document in line with these formatting norms: ${p.normProfile}. Change only formatting — never the wording.`,
  },
  {
    id: "fix_heading_levels",
    family: "formatting",
    reads: [...BASE_READS],
    writes: ["set_heading"],
    params: [],
    instruction: () =>
      "Check the heading hierarchy. Any paragraph that reads as a heading but is not one should become one at the right level, and any level that skips a step should be corrected. Do not change the text of the headings.",
  },
  {
    id: "unify_typography",
    family: "formatting",
    reads: [...BASE_READS, "get_text_style"],
    writes: ["set_text_style", "set_paragraph_text_style", "set_paragraph_spacing"],
    params: [],
    instruction: () =>
      "Make body text, headings, captions and spacing consistent throughout. For Arabic text set the complex-script font and size as well, otherwise the change will not show.",
  },
  {
    id: "proofread",
    family: "language",
    reads: [...BASE_READS, "semantic_search_thesis"],
    writes: ["edit_paragraph"],
    params: ["scope"],
    instruction: (p) =>
      `Proofread ${p.scope}: fix spelling, grammar and punctuation. Keep the student's voice, their vocabulary and their argument exactly as they are — correct mistakes, do not rewrite.`,
  },
  {
    id: "remove_repetition",
    family: "language",
    reads: [...BASE_READS, "semantic_search_thesis"],
    writes: ["edit_paragraph"],
    params: ["scope"],
    instruction: (p) =>
      `Find sentences in ${p.scope} that repeat the same idea or the same word within a line or two, and tighten them. Change as little as possible.`,
  },
  {
    id: "write_abstract",
    family: "language",
    reads: [...BASE_READS, "semantic_search_thesis"],
    writes: ["insert_paragraph", "append_paragraphs"],
    params: ["languages"],
    instruction: (p) =>
      `Write the abstract and its keywords from what the thesis actually says, in these languages: ${p.languages}. Put each version where the thesis expects it.`,
  },
  {
    id: "draft_section",
    family: "content",
    reads: [...BASE_READS, "semantic_search_thesis", "read_source_blocks"],
    writes: ["append_paragraphs", "insert_paragraph"],
    params: ["scope"],
    instruction: (p) =>
      `Draft ${p.scope} from the outline and from what the rest of the thesis already establishes. Match the language and register of the surrounding chapters. Do not invent sources or figures.`,
  },
  {
    id: "custom_block_task",
    family: "content",
    reads: [...BASE_READS],
    writes: ["edit_paragraph"],
    params: ["request", "snippet"],
    instruction: (p) =>
      `The student selected this passage:\n\n"${p.snippet}"\n\nWhat they asked for: ${p.request}\n\nWork only on that passage.`,
  },
];

export type JobId = (typeof JOBS)[number]["id"];

const BY_ID = new Map(JOBS.map((j) => [j.id, j]));

export function jobById(id: string): JobDef {
  const j = BY_ID.get(id);
  if (!j) throw new Error(`unknown task job: ${id}`);
  return j;
}

export function defaultModeFor(id: string): TaskMode {
  return FAMILY_DEFAULT_MODE[jobById(id).family];
}

/**
 * The complete, final tool set for a task. In propose mode every writer is
 * dropped and replaced by `propose_edit` — so a propose task physically cannot
 * change the document, whatever the model decides to do.
 */
export function toolsFor(id: string, mode: TaskMode): string[] {
  const job = jobById(id);
  return mode === "apply" ? [...job.reads, ...job.writes] : [...job.reads, "propose_edit"];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/catalogue.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify every declared tool actually exists**

A typo here silently gives a job fewer tools than intended. Add this test to the same file:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

it("declares only tools that are really registered", () => {
  const dir = join(__dirname, "../../../mcp/tools");
  const src = readdirSync(dir)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
  for (const job of JOBS) {
    for (const tool of [...job.reads, ...job.writes]) {
      expect(src, `${job.id} declares "${tool}"`).toContain(`"${tool}"`);
    }
  }
});
```

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/catalogue.test.ts`
Expected: PASS, 7 tests. If a name fails, fix the catalogue to match the registered name — do not edit the test.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati-server
git add src/lib/tasks/catalogue.ts src/lib/tasks/__tests__/catalogue.test.ts
git commit -m "feat(tasks): the job menu, with each job's tool set declared up front

A run executes with nobody watching, so the destructive gate is pre-satisfied.
What replaces it is this: the toolset is built from exactly these names, so a
job cannot reach a tool it never declared and cannot grow one mid-run."
```

---

## Task 2: Anchor resolution against a drifted document

A task written at 21:00 runs at 23:00. Block indices shift, and blocks have no stable id. This resolves an anchor by trusting the index only while its text still matches, then re-finding by content — the pattern `lib/block-links.ts` uses in the app.

**Files:**
- Create: `src/lib/tasks/anchor.ts`
- Test: `src/lib/tasks/__tests__/anchor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/anchor.test.ts
import { describe, expect, it } from "vitest";
import { resolveAnchor, type BlockAnchor } from "../anchor";

const doc = (...texts: string[]) => texts.map((text, index) => ({ index, text }));

describe("anchor resolution", () => {
  const anchor: BlockAnchor = { index: 2, snippet: "المنهج المتبع في هذه الدراسة" };

  it("keeps the index when the text is still there", () => {
    const blocks = doc("مقدمة", "تمهيد", "المنهج المتبع في هذه الدراسة", "خاتمة");
    expect(resolveAnchor(anchor, blocks)).toBe(2);
  });

  it("re-finds the block after paragraphs were inserted above it", () => {
    const blocks = doc("مقدمة", "جديد", "جديد", "تمهيد", "المنهج المتبع في هذه الدراسة");
    expect(resolveAnchor(anchor, blocks)).toBe(4);
  });

  it("re-finds it after paragraphs were deleted above it", () => {
    const blocks = doc("المنهج المتبع في هذه الدراسة", "خاتمة");
    expect(resolveAnchor(anchor, blocks)).toBe(0);
  });

  it("matches on a prefix when the paragraph was extended", () => {
    const blocks = doc("مقدمة", "تمهيد", "المنهج المتبع في هذه الدراسة هو المنهج الوصفي", "خاتمة");
    expect(resolveAnchor(anchor, blocks)).toBe(2);
  });

  it("returns null rather than guessing when the block is gone", () => {
    expect(resolveAnchor(anchor, doc("مقدمة", "خاتمة"))).toBeNull();
  });

  it("returns null when two blocks match — ambiguous is not resolved", () => {
    const blocks = doc("المنهج المتبع في هذه الدراسة", "x", "المنهج المتبع في هذه الدراسة");
    expect(resolveAnchor(anchor, blocks)).toBeNull();
  });

  it("ignores whitespace differences", () => {
    const blocks = doc("مقدمة", "تمهيد", "  المنهج   المتبع في هذه الدراسة  ");
    expect(resolveAnchor(anchor, blocks)).toBe(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/anchor.test.ts`
Expected: FAIL — `Failed to resolve import "../anchor"`

- [ ] **Step 3: Write the resolver**

```ts
// src/lib/tasks/anchor.ts
/**
 * Blocks have no stable id, and a scheduled task runs against a document that
 * may have moved under it. So an anchor stores the index AND a snippet, and is
 * resolved by CONTENT at run time: the index is a hint, the text is the truth.
 *
 * Deliberately refuses to guess. If the snippet is gone, or matches twice, this
 * returns null and the caller fails the task with a reason — editing the wrong
 * paragraph of someone's thesis at 2am is far worse than not editing at all.
 *
 * PURE MODULE — no IO.
 */

export interface BlockAnchor {
  /** Index when the task was created. A hint, checked before it is trusted. */
  index: number;
  /** Text of the block at creation time. The real identity. */
  snippet: string;
}

export interface DocBlock {
  index: number;
  text: string;
}

/** Collapse runs of whitespace so re-flowed text still matches. */
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Does `block` still carry the anchored text? Prefix match, so an extended paragraph still counts. */
function matches(anchorText: string, blockText: string): boolean {
  const a = norm(anchorText);
  const b = norm(blockText);
  if (!a) return false;
  return b === a || b.startsWith(a) || a.startsWith(b);
}

/**
 * The block this anchor now points at, or null when it cannot be identified
 * beyond doubt.
 */
export function resolveAnchor(anchor: BlockAnchor, blocks: DocBlock[]): number | null {
  const at = blocks.find((b) => b.index === anchor.index);
  if (at && matches(anchor.snippet, at.text)) return at.index;

  const hits = blocks.filter((b) => matches(anchor.snippet, b.text));
  if (hits.length === 1) return hits[0].index;
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/anchor.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/tasks/anchor.ts src/lib/tasks/__tests__/anchor.test.ts
git commit -m "feat(tasks): resolve a block anchor against a document that moved

The index is a hint; the snippet is the identity. Two matches or none means
the task fails with a reason — editing the wrong paragraph at 2am is worse
than not editing at all."
```

---

## Task 3: The three tables

`ensureSchema()` is **not** a working path on production — `templates` hit Postgres's 1600-column ceiling and the seed step is skipped, so DDL added there may never run. The SQL file is the real migration; the Drizzle definitions exist so the rest of the code is typed.

**Files:**
- Create: `src/db/tasks-schema.ts`
- Create: `sql/2026-08-15-tasks.sql`
- Modify: `src/db/index.ts`

- [ ] **Step 1: Write the Drizzle definitions**

```ts
// src/db/tasks-schema.ts
import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { theses } from "./schema";

/**
 * One scheduled job against one thesis: a title, a `when`, and an ordered list
 * of tasks. One run = one notification, one History checkpoint, one report.
 *
 * status: draft → scheduled → running → done | failed | cancelled
 *         running → cancelling → cancelled  (the executor stops between tasks)
 *
 * Two runs on the same thesis cannot execute at once: both queue on
 * `withThesisLock`, which is what "one run at a time per thesis" means in
 * practice — no separate guard is needed.
 */
export const taskRuns = pgTable(
  "task_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    status: text("status").notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Held by the instance executing this run. An expired lease means it died. */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempt: integer("attempt").notNull().default(0),
    /** thesis_doc_history.seq taken before the first task — the run's undo point. */
    historyCheckpoint: integer("history_checkpoint"),
    summary: jsonb("summary").$type<RunSummary>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("task_runs_due").on(t.status, t.scheduledAt), index("task_runs_thesis").on(t.thesisId)],
);

export interface RunSummary {
  applied: number;
  proposed: number;
  failed: number;
  /** Set when the cost ceiling stopped the run early. */
  stoppedForBudget?: boolean;
  /** Set when the run started materially after its scheduled time. */
  lateMinutes?: number;
}

/**
 * One job in a run. `status` is persisted per task precisely so a retry after a
 * crash resumes at the first task that is not `done` — re-applying finished
 * work would be worse than the crash.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => taskRuns.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** A catalogue job id. See lib/tasks/catalogue.ts. */
    kind: text("kind").notNull(),
    params: jsonb("params").$type<Record<string, string>>().notNull().default({}),
    /** { scope?: string, anchor?: { index, snippet } } — never shown to the student as an index. */
    target: jsonb("target").$type<TaskTarget>().notNull().default({}),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("pending"),
    result: jsonb("result").$type<TaskResult>(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("tasks_run").on(t.runId, t.position)],
);

export interface TaskTarget {
  /** Human label — "الفصل الثاني". Never an index. */
  scope?: string;
  anchor?: { index: number; snippet: string };
}

export interface TaskResult {
  /** What the student is told this task did, in their language. */
  message: string;
  /** Why it could not be done. Present only on status "failed". */
  reason?: string;
  proposalIds?: string[];
}

/**
 * The output of a propose-mode task. This table exists because suggestions in
 * the app are client-side only (a Zustand store keyed by block index, never
 * persisted) — a background run has nowhere else to put one.
 */
export const taskProposals = pgTable(
  "task_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
    /** { index, snippet, label } — re-resolved by content when the student opens the app. */
    anchor: jsonb("anchor").$type<{ index: number; snippet: string; label?: string }>().notNull(),
    action: text("action").notNull().default("rewrite"),
    beforeText: text("before_text").notNull().default(""),
    afterText: text("after_text").notNull().default(""),
    /** Why the AI thinks this is better. Shown under the diff. */
    note: text("note").notNull().default(""),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("task_proposals_thesis_status").on(t.thesisId, t.status)],
);
```

- [ ] **Step 2: Write the migration**

```sql
-- sql/2026-08-15-tasks.sql
-- Tasks: a scheduled work queue the student fills and the AI empties.
-- Apply with: psql "$DATABASE_URL" -f sql/2026-08-15-tasks.sql
-- Idempotent.

CREATE TABLE IF NOT EXISTS task_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  thesis_id          uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
  title              text NOT NULL DEFAULT '',
  status             text NOT NULL DEFAULT 'draft',
  scheduled_at       timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  lease_until        timestamptz,
  attempt            integer NOT NULL DEFAULT 0,
  history_checkpoint integer,
  summary            jsonb,
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_runs_due ON task_runs (status, scheduled_at);
CREATE INDEX IF NOT EXISTS task_runs_thesis ON task_runs (thesis_id);

CREATE TABLE IF NOT EXISTS tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  kind        text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  target      jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode        text NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  result      jsonb,
  started_at  timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS tasks_run ON tasks (run_id, position);

CREATE TABLE IF NOT EXISTS task_proposals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  thesis_id   uuid NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
  anchor      jsonb NOT NULL,
  action      text NOT NULL DEFAULT 'rewrite',
  before_text text NOT NULL DEFAULT '',
  after_text  text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_proposals_thesis_status ON task_proposals (thesis_id, status);
```

- [ ] **Step 3: Re-export from the db barrel**

In `src/db/index.ts`, next to the other schema re-exports, add:

```ts
export { taskRuns, tasks, taskProposals } from "./tasks-schema";
export type { RunSummary, TaskTarget, TaskResult } from "./tasks-schema";
```

- [ ] **Step 4: Apply the migration and verify the tables exist**

```bash
cd ~/modakerati-server
psql "$DATABASE_URL" -f sql/2026-08-15-tasks.sql
psql "$DATABASE_URL" -c "\d task_runs" -c "\d tasks" -c "\d task_proposals"
```

Expected: three table descriptions, each with the columns above. Re-running the `-f` command must succeed unchanged.

- [ ] **Step 5: Typecheck**

Run: `cd ~/modakerati-server && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati-server
git add src/db/tasks-schema.ts sql/2026-08-15-tasks.sql src/db/index.ts
git commit -m "feat(tasks): runs, tasks and proposals

Per-task status is persisted so a crashed run resumes at the first task that
is not done. task_proposals exists because app-side suggestions are a Zustand
store that dies with the process — a background run has nowhere to put one."
```

---

## Task 4: Restrict a turn to a declared tool set

`connectMcpToolset` accepts `preloadTools`, which *loads* tools but does not *restrict* them. The catalogue's guarantee needs an allowlist.

**Files:**
- Modify: `src/lib/ai/mcp-bridge.ts:713`
- Modify: `src/lib/ai/tool-loop.ts:885`, `:1294`, `:1720`, `:1751`
- Test: `src/lib/tasks/__tests__/allow-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/allow-tools.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../../ai/tool-log", () => ({ recordToolCall: vi.fn() }));
vi.mock("../../ai/usage-log", () => ({ recordAiCall: vi.fn() }));

import { connectMcpToolset } from "../../ai/mcp-bridge";

describe("allowTools — a task cannot reach a tool its job never declared", () => {
  it("exposes exactly the allowed tools", async () => {
    const set = await connectMcpToolset({
      userId: "u1",
      thesisId: "t1",
      allowTools: ["read_thesis_blocks", "insert_caption"],
    });
    const names = Object.keys(set.tools);
    expect(names.sort()).toEqual(["insert_caption", "read_thesis_blocks"]);
    await set.close?.();
  });

  it("drops load_tools even when the tool set would normally offer it", async () => {
    const set = await connectMcpToolset({
      userId: "u1",
      thesisId: "t1",
      allowTools: ["read_thesis_blocks"],
    });
    expect(Object.keys(set.tools)).not.toContain("load_tools");
    await set.close?.();
  });

  it("changes nothing when allowTools is absent", async () => {
    const set = await connectMcpToolset({ userId: "u1", thesisId: "t1" });
    expect(Object.keys(set.tools).length).toBeGreaterThan(5);
    await set.close?.();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/allow-tools.test.ts`
Expected: FAIL — the first test returns the full tool set, not two names.

- [ ] **Step 3: Add `allowTools` to the bridge**

In `src/lib/ai/mcp-bridge.ts`, extend the signature at line 713:

```ts
export async function connectMcpToolset(ctx: {
  userId: string;
  docMode?: string;
  thesisId?: string;
  threadId?: string;
  turnId?: string;
  model?: string;
  provider?: string;
  preloadTools?: string[];
  /**
   * Hard allowlist. When present, the toolset contains these names and nothing
   * else — no on-demand loading, no defaults. Used by scheduled tasks, where a
   * job declares its tools up front and the run must not be able to grow them
   * (see lib/tasks/catalogue.ts).
   */
  allowTools?: string[];
}): Promise<McpToolset> {
```

The toolset is assembled from `visibleTools` (line 783) into `core` / `extras` / `activated`, with `load_tools` added synthetically. Filtering the *source* is what makes the guarantee hold — filtering the output would leave the on-demand machinery able to add names back.

At line 783, change:

```ts
const visibleTools = mcpTools.filter((t) => isVisible(t.name));
```

to:

```ts
// An allowlisted session (a scheduled task) sees exactly its declared names.
// Filtering HERE rather than at the end is deliberate: core/extras/activated
// and the synthetic load_tools are all built from this list, so nothing can be
// added back downstream.
const allow = ctx.allowTools ? new Set(ctx.allowTools) : null;
const visibleTools = mcpTools.filter((t) => isVisible(t.name) && (!allow || allow.has(t.name)));
```

Then find where the synthetic `load_tools` tool (`LOAD_TOOLS_NAME`, line 82) is added to the returned tool list, and skip it when `allow` is set:

```ts
if (!allow && extras.size > 0) {
  // …existing load_tools registration, unchanged…
}
```

`load_tools` is not in `mcpTools`, so the `visibleTools` filter alone cannot remove it — this second guard is what stops a task growing its own tool set mid-run.

- [ ] **Step 4: Thread it through the tool loop**

In `src/lib/ai/tool-loop.ts`, add `allowTools?: string[];` to the `opts` object type at each of lines 885, 1294, 1723 and 1751, and pass it at both `connectMcpToolset` call sites (lines 916 and 1325):

```ts
const toolset = await connectMcpToolset({ userId: opts.userId, docMode: opts.docMode, thesisId: opts.thesisId, threadId: opts.threadId, turnId, model, provider: provider.name, preloadTools: opts.preloadTools, allowTools: opts.allowTools });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/allow-tools.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 6: Run the full AI suite for regressions**

Run: `cd ~/modakerati-server && npx vitest run src/lib/ai --testTimeout=60000`
Expected: PASS. `allowTools` is optional, so every existing caller is unchanged. Some suites are slow under load — the timeout flag is not optional here.

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati-server
git add src/lib/ai/mcp-bridge.ts src/lib/ai/tool-loop.ts src/lib/tasks/__tests__/allow-tools.test.ts
git commit -m "feat(ai): allowTools — a hard allowlist for a turn's tool set

preloadTools loads tools; it does not restrict them. A scheduled task runs
unattended, so its job's declared tool set has to be the whole world it can
reach — including no load_tools, so it cannot grow one mid-run."
```

---

## Task 5: Task context and the `propose_edit` tool

`propose_edit` needs to know which task it belongs to. The codebase already carries per-turn attribution through AsyncLocalStorage rather than threading a parameter through forty signatures (`usage-log.ts`, `turn-context.ts`, `byok.ts`); this follows that.

**Files:**
- Create: `src/lib/tasks/task-context.ts`
- Create: `src/mcp/tools/tasks.ts`
- Test: `src/lib/tasks/__tests__/task-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/task-context.test.ts
import { describe, expect, it } from "vitest";
import { runWithTask, currentTask } from "../task-context";

describe("task context", () => {
  it("is undefined outside a task", () => {
    expect(currentTask()).toBeUndefined();
  });

  it("carries the task across awaits", async () => {
    await runWithTask({ taskId: "task-1", thesisId: "th-1", userId: "u-1" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(currentTask()?.taskId).toBe("task-1");
    });
    expect(currentTask()).toBeUndefined();
  });

  it("keeps concurrent tasks apart", async () => {
    const seen: string[] = [];
    const one = runWithTask({ taskId: "a", thesisId: "t", userId: "u" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(currentTask()!.taskId);
    });
    const two = runWithTask({ taskId: "b", thesisId: "t", userId: "u" }, async () => {
      seen.push(currentTask()!.taskId);
    });
    await Promise.all([one, two]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/task-context.test.ts`
Expected: FAIL — `Failed to resolve import "../task-context"`

- [ ] **Step 3: Write the context**

```ts
// src/lib/tasks/task-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which task is executing right now. `propose_edit` reads this to know what row
 * to write, the same way usage-log.ts and byok.ts carry per-turn attribution —
 * an ALS rather than a parameter threaded through every tool signature. It
 * propagates across awaits and is per async context, so two runs executing
 * concurrently can never observe each other's task.
 */
export interface TaskContext {
  taskId: string;
  thesisId: string;
  userId: string;
}

const als = new AsyncLocalStorage<TaskContext>();

export function runWithTask<T>(ctx: TaskContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

export function currentTask(): TaskContext | undefined {
  return als.getStore();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/task-context.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Register `propose_edit`**

The registration shape is `server.tool(name, description, { zod schema }, async handler)` with `server: McpServer` — see `src/mcp/tools/docx-blocks.ts:17`.

Note what this tool deliberately does **not** declare: `userId` and `thesisId`. Other tools declare them and have them server-injected; here they come from the task context instead, so there is no parameter for a model to fill in with someone else's id.

```ts
// src/mcp/tools/tasks.ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { db, taskProposals } from "../../db";
import { currentTask } from "../../lib/tasks/task-context";

/**
 * The ONLY writer a propose-mode task is given. It changes nothing in the
 * document — it records what the AI would have done, for the student to accept
 * or reject when they open the app.
 *
 * Does NOT declare userId/thesisId. Every other tool declares them and has them
 * injected; this one reads them off the task context, so there is no parameter
 * for a model to fill in with an id that isn't its own.
 */
export function registerTaskTools(server: McpServer): void {
  server.tool(
    "propose_edit",
    "Propose a rewrite of one paragraph for the student to accept or reject. Use this INSTEAD of editing whenever you are working on a task in propose mode — nothing changes in the document until the student approves it. Call it once per paragraph you would change.",
    {
      blockIndex: z.number().describe("Zero-based block index of the paragraph you are proposing a change to"),
      beforeText: z.string().describe("The paragraph's current text, exactly as it is now"),
      afterText: z.string().describe("Your proposed replacement text — one paragraph"),
      note: z.string().describe("One short sentence, in the student's language, saying what you changed and why"),
    },
    async ({ blockIndex, beforeText, afterText, note }) => {
      const ctx = currentTask();
      if (!ctx) {
        return { content: [{ type: "text" as const, text: "propose_edit is only available inside a scheduled task." }] };
      }
      const [row] = await db
        .insert(taskProposals)
        .values({
          taskId: ctx.taskId,
          thesisId: ctx.thesisId,
          anchor: { index: blockIndex, snippet: beforeText.slice(0, 240) },
          action: "rewrite",
          beforeText,
          afterText,
          note,
        })
        .returning({ id: taskProposals.id });
      return { content: [{ type: "text" as const, text: `Proposal recorded (${row.id}). Continue with the rest of the task.` }] };
    },
  );
}
```

Then call `registerTaskTools(server)` in `createMcpServer()` (`src/lib/ai/mcp-bridge.ts`), alongside the other `register*` calls.

- [ ] **Step 6: Verify the tool is registered**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/catalogue.test.ts`
Expected: PASS — the "declares only tools that are really registered" test now also finds `propose_edit`.

Then add `propose_edit` to the same registered-name check by extending that test's tool list to include the propose-mode set:

```ts
it("registers propose_edit, the only writer a propose task gets", () => {
  const src = readFileSync(join(__dirname, "../../../mcp/tools/tasks.ts"), "utf8");
  expect(src).toContain('"propose_edit"');
});
```

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/catalogue.test.ts`
Expected: PASS, 8 tests

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati-server
git add src/lib/tasks/task-context.ts src/mcp/tools/tasks.ts src/lib/ai/mcp-bridge.ts src/lib/tasks/__tests__/task-context.test.ts src/lib/tasks/__tests__/catalogue.test.ts
git commit -m "feat(tasks): propose_edit, the only writer a propose-mode task gets

It records what the AI would have done instead of doing it. Which task it
belongs to rides an AsyncLocalStorage, the way usage-log and byok already
carry per-turn attribution."
```

---

## Task 6: The executor

Runs one run. Dependencies are injected so this unit-tests with no database, no Supabase and no model — the alternative is six `vi.mock` calls and a test that proves the mocks work.

**Files:**
- Create: `src/lib/tasks/executor.ts`
- Test: `src/lib/tasks/__tests__/executor.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/executor.test.ts
import { describe, expect, it, vi } from "vitest";
import { executeRun, type ExecutorDeps, type RunRow, type TaskRow } from "../executor";

const run = (over: Partial<RunRow> = {}): RunRow => ({
  id: "run-1", userId: "u-1", thesisId: "th-1", attempt: 0, ...over,
});

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "task-1", position: 0, kind: "fix_captions", params: {}, target: {},
  mode: "apply", status: "pending", ...over,
});

function deps(over: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return {
    withLock: async <T,>(_id: string, fn: () => Promise<T>) => fn(),
    snapshot: vi.fn().mockResolvedValue(7),
    runTask: vi.fn().mockResolvedValue({ message: "done", tokens: 1000 }),
    setTaskStatus: vi.fn().mockResolvedValue(undefined),
    finishRun: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn().mockResolvedValue(undefined),
    countProposals: vi.fn().mockResolvedValue(0),
    cancelled: vi.fn().mockResolvedValue(false),
    now: () => new Date("2026-08-15T23:00:00Z"),
    maxTokens: 500_000,
    ...over,
  };
}

describe("executeRun", () => {
  it("snapshots once for the whole run, before any task", async () => {
    const d = deps();
    await executeRun(run(), [task(), task({ id: "task-2", position: 1 })], d);
    expect(d.snapshot).toHaveBeenCalledTimes(1);
  });

  it("runs tasks in position order", async () => {
    const order: string[] = [];
    const d = deps({ runTask: vi.fn(async (t: TaskRow) => { order.push(t.id); return { message: "ok", tokens: 0 }; }) });
    await executeRun(run(), [task({ id: "b", position: 1 }), task({ id: "a", position: 0 })], d);
    expect(order).toEqual(["a", "b"]);
  });

  it("carries on after a task fails, and records why", async () => {
    const d = deps({
      runTask: vi.fn(async (t: TaskRow) => {
        if (t.id === "task-1") throw new Error("that paragraph no longer exists");
        return { message: "ok", tokens: 0 };
      }),
    });
    await executeRun(run(), [task(), task({ id: "task-2", position: 1 })], d);
    expect(d.runTask).toHaveBeenCalledTimes(2);
    expect(d.setTaskStatus).toHaveBeenCalledWith("task-1", "failed",
      expect.objectContaining({ reason: "that paragraph no longer exists" }));
    expect(d.finishRun).toHaveBeenCalledWith("run-1", "done",
      expect.objectContaining({ applied: 1, failed: 1 }), 7);
  });

  it("resumes at the first task that is not done", async () => {
    const d = deps();
    await executeRun(run({ attempt: 1 }), [
      task({ id: "a", position: 0, status: "done" }),
      task({ id: "b", position: 1 }),
    ], d);
    expect(d.runTask).toHaveBeenCalledTimes(1);
    expect((d.runTask as any).mock.calls[0][0].id).toBe("b");
  });

  it("stops at the token ceiling and says which tasks never ran", async () => {
    const d = deps({
      maxTokens: 50_000,
      runTask: vi.fn().mockResolvedValue({ message: "ok", tokens: 40_000 }),
    });
    await executeRun(run(), [task({ id: "a", position: 0 }), task({ id: "b", position: 1 }), task({ id: "c", position: 2 })], d);
    expect(d.runTask).toHaveBeenCalledTimes(2);
    expect(d.setTaskStatus).toHaveBeenCalledWith("c", "skipped",
      expect.objectContaining({ reason: expect.stringContaining("budget") }));
    expect(d.finishRun).toHaveBeenCalledWith("run-1", "done",
      expect.objectContaining({ stoppedForBudget: true }), 7);
  });

  it("stops between tasks when the run was cancelled", async () => {
    const d = deps({ cancelled: vi.fn().mockResolvedValue(true) });
    await executeRun(run(), [task({ id: "a", position: 0 }), task({ id: "b", position: 1 })], d);
    expect(d.runTask).not.toHaveBeenCalled();
    expect(d.finishRun).toHaveBeenCalledWith("run-1", "cancelled", expect.anything(), 7);
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("sends exactly one notification", async () => {
    const d = deps();
    await executeRun(run(), [task(), task({ id: "task-2", position: 1 })], d);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("records how late it ran when the window was missed", async () => {
    const d = deps({ now: () => new Date("2026-08-16T01:30:00Z") });
    await executeRun(run({ scheduledAt: new Date("2026-08-15T23:00:00Z") }), [task()], d);
    expect(d.finishRun).toHaveBeenCalledWith("run-1", "done",
      expect.objectContaining({ lateMinutes: 150 }), 7);
  });

  it("counts a propose task as proposed, not applied", async () => {
    const d = deps({ countProposals: vi.fn().mockResolvedValue(3) });
    await executeRun(run(), [task({ mode: "propose" })], d);
    expect(d.finishRun).toHaveBeenCalledWith("run-1", "done",
      expect.objectContaining({ applied: 0, proposed: 3 }), 7);
  });

  it("everything happens inside the thesis lock", async () => {
    const calls: string[] = [];
    const d = deps({
      withLock: async <T,>(id: string, fn: () => Promise<T>) => { calls.push(`lock:${id}`); const r = await fn(); calls.push("unlock"); return r; },
      snapshot: vi.fn(async () => { calls.push("snapshot"); return 7; }),
      runTask: vi.fn(async () => { calls.push("task"); return { message: "ok", tokens: 0 }; }),
    });
    await executeRun(run(), [task()], d);
    expect(calls).toEqual(["lock:th-1", "snapshot", "task", "unlock"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/executor.test.ts`
Expected: FAIL — `Failed to resolve import "../executor"`

- [ ] **Step 3: Write the executor**

```ts
// src/lib/tasks/executor.ts
import type { RunSummary, TaskResult, TaskTarget } from "../../db/tasks-schema";
import type { TaskMode } from "./catalogue";

/**
 * Executes one scheduled run: lock the thesis, snapshot once, work down the
 * list, notify.
 *
 * WHY DEPENDENCIES ARE INJECTED
 * -----------------------------
 * The real thing needs Postgres, Supabase storage, the MCP bridge and a model.
 * Mocking four modules produces a test that proves the mocks work. Passing them
 * in means the rules below — order, resume point, budget stop, carry on after a
 * failure — are tested for real, with no IO at all.
 */

export interface RunRow {
  id: string;
  userId: string;
  thesisId: string;
  attempt: number;
  scheduledAt?: Date | null;
}

export interface TaskRow {
  id: string;
  position: number;
  kind: string;
  params: Record<string, string>;
  target: TaskTarget;
  mode: TaskMode;
  status: string;
}

export interface TaskOutcome {
  message: string;
  /**
   * Total tokens the task spent. NOT dollars: `ai_usage_log.cost` is NULL on
   * every provider that doesn't report a price, and Cloudflare — the default
   * here — is one of them. A dollar ceiling would silently never fire. Tokens
   * are always on ToolChatResult.usage.
   */
  tokens: number;
}

export interface ExecutorDeps {
  withLock<T>(thesisId: string, fn: () => Promise<T>): Promise<T>;
  snapshot(run: RunRow): Promise<number | null>;
  runTask(task: TaskRow, run: RunRow): Promise<TaskOutcome>;
  setTaskStatus(taskId: string, status: string, result: TaskResult): Promise<void>;
  finishRun(runId: string, status: string, summary: RunSummary, checkpoint: number | null): Promise<void>;
  notify(run: RunRow, summary: RunSummary): Promise<void>;
  countProposals(taskId: string): Promise<number>;
  /** Has the student cancelled since this run started? Checked between tasks. */
  cancelled(runId: string): Promise<boolean>;
  now(): Date;
  maxTokens: number;
}

/** A run started this long after its scheduled time is reported as late. */
const LATE_AFTER_MINUTES = 10;

export async function executeRun(run: RunRow, allTasks: TaskRow[], deps: ExecutorDeps): Promise<RunSummary> {
  const summary: RunSummary = { applied: 0, proposed: 0, failed: 0 };

  if (run.scheduledAt) {
    const late = Math.round((deps.now().getTime() - run.scheduledAt.getTime()) / 60000);
    if (late >= LATE_AFTER_MINUTES) summary.lateMinutes = late;
  }

  let cancelled = false;

  const checkpoint = await deps.withLock(run.thesisId, async () => {
    // One snapshot for the whole run — the History ring cannot absorb one per
    // task, so undo is per run. This is why the risky families default to
    // propose mode, where the fine-grained control lives.
    const seq = await deps.snapshot(run);

    // A retry resumes here. Re-running a task that already landed would apply
    // its edit twice, which is worse than the crash that caused the retry.
    const pending = allTasks
      .filter((t) => t.status !== "done")
      .sort((a, b) => a.position - b.position);

    let spent = 0;
    for (let i = 0; i < pending.length; i++) {
      const task = pending[i];

      // Cancellation is checked BETWEEN tasks, never inside one: killing a turn
      // mid-flight would leave the document half-edited with no record of it.
      if (await deps.cancelled(run.id)) {
        cancelled = true;
        for (const rest of pending.slice(i)) {
          await deps.setTaskStatus(rest.id, "skipped", {
            message: "Not attempted",
            reason: "you cancelled the run",
          });
        }
        break;
      }

      if (deps.maxTokens - spent <= 0) {
        // No silent truncation: every task that never ran says so.
        for (const rest of pending.slice(i)) {
          await deps.setTaskStatus(rest.id, "skipped", {
            message: "Not attempted",
            reason: "the run reached its budget before this task",
          });
        }
        summary.stoppedForBudget = true;
        break;
      }

      try {
        const out = await deps.runTask(task, run);
        spent += out.tokens;
        if (task.mode === "propose") {
          const n = await deps.countProposals(task.id);
          summary.proposed += n;
          await deps.setTaskStatus(task.id, "done", { message: out.message });
        } else {
          summary.applied += 1;
          await deps.setTaskStatus(task.id, "done", { message: out.message });
        }
      } catch (err: any) {
        // One task failing is not the run failing. It is abandoned with a
        // reason the student will read, and the next one starts.
        summary.failed += 1;
        await deps.setTaskStatus(task.id, "failed", {
          message: "Couldn't be done",
          reason: err?.message ?? String(err),
        });
      }
    }

    return seq;
  });

  await deps.finishRun(run.id, cancelled ? "cancelled" : "done", summary, checkpoint);
  // A student who cancelled does not want a push telling them it finished.
  if (!cancelled) await deps.notify(run, summary);
  return summary;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/executor.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/tasks/executor.ts src/lib/tasks/__tests__/executor.test.ts
git commit -m "feat(tasks): the executor — one snapshot, then work down the list

A failed task is abandoned with a reason and the run continues; a retry
resumes at the first task that is not done; the budget ceiling names every
task it skipped rather than truncating in silence."
```

---

## Task 7: Running a single task for real

The `runTask` dependency the executor takes. This is where the catalogue, the anchor and `chatWithTools` meet.

**Files:**
- Create: `src/lib/tasks/run-task.ts`
- Test: `src/lib/tasks/__tests__/run-task.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/run-task.test.ts
import { describe, expect, it, vi } from "vitest";
import { buildTurn } from "../run-task";

describe("buildTurn — what a task actually asks the model to do", () => {
  it("restricts an apply task to its job's tools", () => {
    const turn = buildTurn({
      id: "t1", position: 0, kind: "fix_captions", params: {}, target: {},
      mode: "apply", status: "pending",
    });
    expect(turn.allowTools).toContain("convert_text_captions_to_real_captions");
    expect(turn.allowTools).not.toContain("propose_edit");
    expect(turn.allowTools).not.toContain("delete_block");
  });

  it("gives a propose task propose_edit and no writers", () => {
    const turn = buildTurn({
      id: "t1", position: 0, kind: "proofread", params: { scope: "الفصل الثاني" }, target: {},
      mode: "propose", status: "pending",
    });
    expect(turn.allowTools).toContain("propose_edit");
    expect(turn.allowTools).not.toContain("edit_paragraph");
  });

  it("puts the scope in the instruction, never an index", () => {
    const turn = buildTurn({
      id: "t1", position: 0, kind: "proofread", params: { scope: "الفصل الثاني" }, target: {},
      mode: "propose", status: "pending",
    });
    expect(turn.message).toContain("الفصل الثاني");
    expect(turn.message).not.toMatch(/block\s*\d+|index\s*\d+/i);
  });

  it("tells a propose task it must not edit directly", () => {
    const turn = buildTurn({
      id: "t1", position: 0, kind: "proofread", params: { scope: "x" }, target: {},
      mode: "propose", status: "pending",
    });
    expect(turn.message.toLowerCase()).toContain("propose_edit");
  });

  it("passes the resolved block through for an anchored task", () => {
    const turn = buildTurn({
      id: "t1", position: 0, kind: "custom_block_task",
      params: { request: "اجعلها أوضح", snippet: "المنهج المتبع" },
      target: { anchor: { index: 4, snippet: "المنهج المتبع" } },
      mode: "propose", status: "pending",
    }, 9);
    expect(turn.docBlockIndex).toBe(9);
    expect(turn.message).toContain("اجعلها أوضح");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/run-task.test.ts`
Expected: FAIL — `Failed to resolve import "../run-task"`

- [ ] **Step 3: Write it**

```ts
// src/lib/tasks/run-task.ts
import { jobById, toolsFor } from "./catalogue";
import { resolveAnchor, type DocBlock } from "./anchor";
import { runWithTask } from "./task-context";
import { chatWithTools } from "../ai/tool-loop";
import type { TaskRow, RunRow, TaskOutcome } from "./executor";

/**
 * Turn a task row into the exact turn that will execute it: the instruction the
 * job builds, and the tool set the job declares. Pure — no IO — so the rules
 * are testable without a model.
 */
export function buildTurn(task: TaskRow, resolvedIndex?: number): {
  message: string;
  allowTools: string[];
  docBlockIndex?: number;
} {
  const job = jobById(task.kind);
  const allowTools = toolsFor(task.kind, task.mode);
  let message = job.instruction(task.params);

  if (task.mode === "propose") {
    message +=
      "\n\nThis task is in propose mode. Do NOT change the document. For every change you would make, call propose_edit with the paragraph's current text, your replacement, and one short sentence saying why. The student will accept or reject each one.";
  }

  return { message, allowTools, docBlockIndex: resolvedIndex };
}

/**
 * Execute one task. The anchor is re-resolved here, immediately before the
 * turn, because the document may have moved since the task was written — and a
 * miss fails the task rather than editing whatever now sits at that index.
 */
export async function runTaskReal(
  task: TaskRow,
  run: RunRow,
  readBlocks: (thesisId: string) => Promise<DocBlock[]>,
  provider: Parameters<typeof chatWithTools>[0],
): Promise<TaskOutcome> {
  let resolved: number | undefined;
  if (task.target.anchor) {
    const blocks = await readBlocks(run.thesisId);
    const at = resolveAnchor(task.target.anchor, blocks);
    if (at === null) {
      throw new Error("the paragraph this task was attached to is no longer in the document");
    }
    resolved = at;
  }

  const turn = buildTurn(task, resolved);

  const result = await runWithTask(
    { taskId: task.id, thesisId: run.thesisId, userId: run.userId },
    () =>
      chatWithTools(provider, [{ role: "user", content: turn.message }], {
        userId: run.userId,
        thesisId: run.thesisId,
        docMode: "live",
        docBlockIndex: turn.docBlockIndex,
        allowTools: turn.allowTools,
        maxSteps: 12,
        metadata: { taskId: task.id, runId: run.id, job: task.kind, mode: task.mode },
      }),
  );

  // ToolChatResult carries `usage`, not a price — see TaskOutcome.tokens for
  // why the run budget counts tokens rather than dollars.
  return { message: result.content.trim(), tokens: result.usage?.totalTokens ?? 0 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/run-task.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Typecheck and commit**

```bash
cd ~/modakerati-server
npx tsc --noEmit
git add src/lib/tasks/run-task.ts src/lib/tasks/__tests__/run-task.test.ts
git commit -m "feat(tasks): execute one task under its job's declared tool set

The anchor is re-resolved immediately before the turn, because the document
may have moved since the task was written. A miss fails the task instead of
editing whatever now sits at that index."
```

---

## Task 8: Claiming due runs

Two ticks can overlap. The claim must be a single guarded UPDATE, not a SELECT followed by an UPDATE.

**Files:**
- Create: `src/lib/tasks/claim.ts`
- Test: `src/lib/tasks/__tests__/claim.test.ts`

- [ ] **Step 1: Write the failing test**

This one needs a real database — a race cannot be tested against a fake. It skips cleanly when `DATABASE_URL` is unset.

```ts
// src/lib/tasks/__tests__/claim.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db, taskRuns, theses } from "../../../db";
import { claimDueRuns, releaseExpired } from "../claim";
import { eq } from "drizzle-orm";

const HAS_DB = !!process.env.DATABASE_URL;

describe.skipIf(!HAS_DB)("claiming due runs", () => {
  let thesisId: string;
  const userId = "00000000-0000-0000-0000-0000000000aa";
  const made: string[] = [];

  beforeAll(async () => {
    const [t] = await db.select({ id: theses.id }).from(theses).limit(1);
    if (!t) throw new Error("no thesis in the database to attach a test run to");
    thesisId = t.id;
  });

  afterAll(async () => {
    for (const id of made) await db.delete(taskRuns).where(eq(taskRuns.id, id));
  });

  async function makeDueRun(): Promise<string> {
    const [r] = await db.insert(taskRuns).values({
      userId, thesisId, status: "scheduled",
      scheduledAt: new Date(Date.now() - 60_000),
    }).returning({ id: taskRuns.id });
    made.push(r.id);
    return r.id;
  }

  it("claims a run that is due", async () => {
    const id = await makeDueRun();
    const claimed = await claimDueRuns(5);
    expect(claimed.map((r) => r.id)).toContain(id);
  });

  it("two concurrent ticks claim it at most once", async () => {
    const id = await makeDueRun();
    const [a, b] = await Promise.all([claimDueRuns(5), claimDueRuns(5)]);
    const total = [...a, ...b].filter((r) => r.id === id).length;
    expect(total).toBe(1);
  });

  it("leaves a run that is not due yet", async () => {
    const [r] = await db.insert(taskRuns).values({
      userId, thesisId, status: "scheduled",
      scheduledAt: new Date(Date.now() + 3_600_000),
    }).returning({ id: taskRuns.id });
    made.push(r.id);
    const claimed = await claimDueRuns(5);
    expect(claimed.map((x) => x.id)).not.toContain(r.id);
  });

  it("re-offers a run whose lease expired, once", async () => {
    const [r] = await db.insert(taskRuns).values({
      userId, thesisId, status: "running", attempt: 0,
      scheduledAt: new Date(Date.now() - 600_000),
      leaseUntil: new Date(Date.now() - 60_000),
    }).returning({ id: taskRuns.id });
    made.push(r.id);

    await releaseExpired();
    const first = await claimDueRuns(5);
    expect(first.map((x) => x.id)).toContain(r.id);

    await db.update(taskRuns)
      .set({ status: "running", leaseUntil: new Date(Date.now() - 60_000), attempt: 1 })
      .where(eq(taskRuns.id, r.id));
    await releaseExpired();
    const [row] = await db.select({ status: taskRuns.status }).from(taskRuns).where(eq(taskRuns.id, r.id));
    expect(row.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/claim.test.ts`
Expected: FAIL — `Failed to resolve import "../claim"`. If it reports all tests skipped, `DATABASE_URL` is not set; export it from `.env` and re-run — this test is not optional.

- [ ] **Step 3: Write the claim queries**

```ts
// src/lib/tasks/claim.ts
import { sql } from "drizzle-orm";
import { db } from "../../db";
import type { RunRow } from "./executor";

/** How long a claimed run holds its lease before another tick may take it. */
const LEASE_MINUTES = 30;

/** A run may be retried once after a crash; the second expiry fails it. */
const MAX_ATTEMPTS = 2;

/**
 * Claim up to `limit` due runs, atomically.
 *
 * One statement, not SELECT-then-UPDATE: two ticks a millisecond apart would
 * both read the same row and both execute it, applying every edit twice.
 * `FOR UPDATE SKIP LOCKED` lets a second tick pass over rows the first has
 * taken rather than blocking behind them.
 */
export async function claimDueRuns(limit: number): Promise<RunRow[]> {
  const { rows } = await db.execute(sql`
    UPDATE task_runs SET
      status = 'running',
      started_at = COALESCE(started_at, now()),
      lease_until = now() + (${LEASE_MINUTES} || ' minutes')::interval,
      attempt = attempt + 1
    WHERE id IN (
      SELECT id FROM task_runs
      WHERE status = 'scheduled' AND scheduled_at <= now()
      ORDER BY scheduled_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id, thesis_id, attempt, scheduled_at
  `);

  return (rows as any[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    thesisId: r.thesis_id,
    attempt: r.attempt,
    scheduledAt: r.scheduled_at ? new Date(r.scheduled_at) : null,
  }));
}

/**
 * A run whose lease expired died with its process. Put it back for one more
 * attempt; a run that has already used its attempts is failed, so a job that
 * crashes the server cannot be retried forever.
 */
export async function releaseExpired(): Promise<void> {
  await db.execute(sql`
    UPDATE task_runs
    SET status = CASE WHEN attempt >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'scheduled' END,
        lease_until = NULL,
        finished_at = CASE WHEN attempt >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END
    WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until < now()
  `);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/claim.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add src/lib/tasks/claim.ts src/lib/tasks/__tests__/claim.test.ts
git commit -m "feat(tasks): claim due runs atomically

One guarded UPDATE with SKIP LOCKED, not SELECT-then-UPDATE: two ticks a
millisecond apart would otherwise both execute the same run and apply every
edit twice. An expired lease is re-offered once, then failed."
```

---

## Task 9: The notification

**Files:**
- Modify: `src/lib/notifications.ts:7`
- Create: `src/lib/tasks/notify.ts`
- Test: `src/lib/tasks/__tests__/notify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/notify.test.ts
import { describe, expect, it } from "vitest";
import { summaryLine } from "../notify";

describe("what the push actually says", () => {
  it("leads with what got done", () => {
    expect(summaryLine({ applied: 6, proposed: 3, failed: 1 }))
      .toBe("6 done · 3 waiting for you · 1 couldn't be done");
  });

  it("omits the parts that are zero", () => {
    expect(summaryLine({ applied: 4, proposed: 0, failed: 0 })).toBe("4 done");
  });

  it("says so when the budget stopped it", () => {
    expect(summaryLine({ applied: 2, proposed: 0, failed: 0, stoppedForBudget: true }))
      .toBe("2 done · stopped early");
  });

  it("has something to say even when nothing worked", () => {
    expect(summaryLine({ applied: 0, proposed: 0, failed: 2 }))
      .toBe("2 couldn't be done");
  });

  it("uses the singular for one", () => {
    expect(summaryLine({ applied: 1, proposed: 1, failed: 1 }))
      .toBe("1 done · 1 waiting for you · 1 couldn't be done");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/notify.test.ts`
Expected: FAIL — `Failed to resolve import "../notify"`

- [ ] **Step 3: Add the notification type**

In `src/lib/notifications.ts`, extend `NotifType` at line 7:

```ts
export type NotifType =
  | "ai_complete"
  | "export"
  | "payment"
  | "system"
  | "grammar"
  | "template"
  | "subscription"
  | "welcome"
  | "tasks_complete";
```

- [ ] **Step 4: Write the notifier**

```ts
// src/lib/tasks/notify.ts
import { createNotification } from "../notifications";
import type { RunSummary } from "../../db/tasks-schema";
import type { RunRow } from "./executor";

/**
 * The one line the student reads on their lock screen. English here; the app
 * localises from `data` (ar/fr/en) — the locale JSONs must be edited
 * SURGICALLY, they carry ~155 duplicate keys and a load/dump round-trip eats
 * them.
 */
export function summaryLine(s: RunSummary): string {
  const parts: string[] = [];
  if (s.applied > 0) parts.push(`${s.applied} done`);
  if (s.proposed > 0) parts.push(`${s.proposed} waiting for you`);
  if (s.failed > 0) parts.push(`${s.failed} couldn't be done`);
  if (s.stoppedForBudget) parts.push("stopped early");
  return parts.length ? parts.join(" · ") : "nothing to do";
}

/** One push per run. Never one per task. */
export async function notifyRunFinished(run: RunRow, summary: RunSummary): Promise<void> {
  await createNotification(run.userId, {
    type: "tasks_complete",
    title: "Your task list is finished",
    description: summaryLine(summary),
    data: { runId: run.id, thesisId: run.thesisId, ...summary },
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/notify.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati-server
git add src/lib/notifications.ts src/lib/tasks/notify.ts src/lib/tasks/__tests__/notify.test.ts
git commit -m "feat(tasks): one push per run, saying what actually happened"
```

---

## Task 10: The tick endpoint and run CRUD

**Files:**
- Create: `src/routes/tasks.ts`
- Modify: `src/index.ts:117`
- Test: `src/lib/tasks/__tests__/tick-auth.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tasks/__tests__/tick-auth.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { tickAuthorized } from "../../../routes/tasks";

describe("tick authorization", () => {
  beforeEach(() => { process.env.TASKS_TICK_SECRET = "s3cret"; });

  it("accepts the configured secret", () => {
    expect(tickAuthorized("s3cret")).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(tickAuthorized("nope")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(tickAuthorized(undefined)).toBe(false);
  });

  it("refuses everything when no secret is configured — an open tick endpoint is worse than a broken one", () => {
    delete process.env.TASKS_TICK_SECRET;
    expect(tickAuthorized("anything")).toBe(false);
    expect(tickAuthorized(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/tick-auth.test.ts`
Expected: FAIL — `Failed to resolve import "../../../routes/tasks"`

- [ ] **Step 3: Write the route**

Open `src/routes/chat-threads.ts` first and copy how it declares `new Hono<{ Variables: AppVariables }>()` and how it reads the authenticated user id — match that exactly rather than inventing an auth pattern.

```ts
// src/routes/tasks.ts
import { Hono } from "hono";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, taskRuns, tasks as taskTable, taskProposals } from "../db";
import type { AppVariables } from "../types"; // whatever chat-threads.ts imports
import { claimDueRuns, releaseExpired } from "../lib/tasks/claim";
import { defaultModeFor, jobById } from "../lib/tasks/catalogue";
import { executeRun } from "../lib/tasks/executor";

export const taskRoutes = new Hono<{ Variables: AppVariables }>();

/**
 * The tick is called by a cron, not by a signed-in student, so it carries a
 * shared secret instead of a session. With no secret configured it refuses
 * everything: an open endpoint that executes AI runs against real theses is a
 * far worse failure than a feature that does not fire.
 */
export function tickAuthorized(header: string | undefined): boolean {
  const secret = process.env.TASKS_TICK_SECRET;
  if (!secret) return false;
  return header === secret;
}

taskRoutes.post("/tick", async (c) => {
  if (!tickAuthorized(c.req.header("x-tasks-secret"))) return c.json({ error: "unauthorized" }, 401);

  await releaseExpired();
  const due = await claimDueRuns(3);

  // Do not await the runs: a tick must answer the cron immediately, and a run
  // takes minutes. The lease is what protects the row while this proceeds.
  for (const run of due) {
    void executeOne(run).catch((e) => console.error("[tasks] run failed:", run.id, e?.message ?? e));
  }

  return c.json({ claimed: due.length });
});

/** Wire the executor to its real dependencies. */
async function executeOne(run: Awaited<ReturnType<typeof claimDueRuns>>[number]) {
  const rows = await db.select().from(taskTable).where(eq(taskTable.runId, run.id)).orderBy(asc(taskTable.position));
  const { withThesisLock } = await import("../lib/thesis-lock");
  const { snapshotCurrentDoc } = await import("../lib/thesis-history");
  const { runTaskReal } = await import("../lib/tasks/run-task");
  const { notifyRunFinished } = await import("../lib/tasks/notify");
  const { getProvider } = await import("../lib/ai");

  await executeRun(run, rows as any, {
    withLock: withThesisLock,
    snapshot: (r) => snapshotCurrentDoc({
      thesisId: r.thesisId, userId: r.userId,
      label: "Before your task list", source: "ai",
    }),
    runTask: (task, r) => runTaskReal(task, r, readBlocksFor, getProvider()),
    setTaskStatus: async (taskId, status, result) => {
      await db.update(taskTable)
        .set({ status, result, finishedAt: new Date() })
        .where(eq(taskTable.id, taskId));
    },
    finishRun: async (runId, status, summary, checkpoint) => {
      await db.update(taskRuns)
        .set({ status, summary, historyCheckpoint: checkpoint, finishedAt: new Date(), leaseUntil: null })
        .where(eq(taskRuns.id, runId));
    },
    notify: notifyRunFinished,
    countProposals: async (taskId) => {
      const rows = await db.select({ id: taskProposals.id })
        .from(taskProposals).where(eq(taskProposals.taskId, taskId));
      return rows.length;
    },
    cancelled: async (runId) => {
      const [row] = await db.select({ status: taskRuns.status }).from(taskRuns).where(eq(taskRuns.id, runId));
      return row?.status === "cancelling";
    },
    now: () => new Date(),
    maxTokens: Number(process.env.TASKS_MAX_TOKENS) || 400_000,
  });
}

/**
 * Blocks as {index, text} for anchor resolution. Use the same reader the
 * document routes use — see src/routes/thesis/document.ts for the existing
 * call, and reuse it rather than opening the .docx a second way.
 */
async function readBlocksFor(thesisId: string): Promise<{ index: number; text: string }[]> {
  const { readThesisBlocks } = await import("../routes/thesis/shared");
  const blocks = await readThesisBlocks(thesisId);
  return blocks.map((b: any, index: number) => ({ index, text: b.text ?? "" }));
}

// ---------- CRUD the app will use in phase 2 ----------

/** The one draft run collecting tasks for this thesis, created on demand. */
taskRoutes.get("/runs/next", async (c) => {
  const userId = c.get("userId");
  const thesisId = c.req.query("thesisId");
  if (!thesisId) return c.json({ error: "thesisId required" }, 400);

  let [run] = await db.select().from(taskRuns)
    .where(and(eq(taskRuns.userId, userId), eq(taskRuns.thesisId, thesisId), eq(taskRuns.status, "draft")));
  if (!run) {
    [run] = await db.insert(taskRuns).values({ userId, thesisId, status: "draft" }).returning();
  }
  const items = await db.select().from(taskTable).where(eq(taskTable.runId, run.id)).orderBy(asc(taskTable.position));
  return c.json({ run, tasks: items });
});

taskRoutes.post("/runs/:runId/tasks", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");
  const body = await c.req.json<{ kind: string; params?: Record<string, string>; target?: any; mode?: string }>();

  const [run] = await db.select().from(taskRuns)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId)));
  if (!run) return c.json({ error: "not found" }, 404);

  try { jobById(body.kind); } catch { return c.json({ error: "unknown job" }, 400); }

  const existing = await db.select({ id: taskTable.id }).from(taskTable).where(eq(taskTable.runId, runId));
  const [row] = await db.insert(taskTable).values({
    runId,
    position: existing.length,
    kind: body.kind,
    params: body.params ?? {},
    target: body.target ?? {},
    mode: body.mode ?? defaultModeFor(body.kind),
  }).returning();

  return c.json({ task: row });
});

taskRoutes.post("/runs/:runId/schedule", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");
  const { scheduledAt, title } = await c.req.json<{ scheduledAt: string; title?: string }>();

  const [row] = await db.update(taskRuns)
    .set({ status: "scheduled", scheduledAt: new Date(scheduledAt), title: title ?? "" })
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId), eq(taskRuns.status, "draft")))
    .returning();
  if (!row) return c.json({ error: "not found or already scheduled" }, 404);
  return c.json({ run: row });
});

/**
 * Run now — the same run row and the same executor, started from the request
 * instead of from a tick. It skips only the claim. This is also what a BYOK
 * student gets instead of scheduling: their key exists only inside a request,
 * so a 2am run has nothing to call the model with.
 */
taskRoutes.post("/runs/:runId/run-now", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");

  const [row] = await db.update(taskRuns)
    .set({ status: "running", startedAt: new Date(), scheduledAt: new Date(),
           leaseUntil: new Date(Date.now() + 30 * 60_000), attempt: sql`attempt + 1` })
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId),
               inArray(taskRuns.status, ["draft", "scheduled"])))
    .returning();
  if (!row) return c.json({ error: "not found or already running" }, 404);

  void executeOne({
    id: row.id, userId: row.userId, thesisId: row.thesisId,
    attempt: row.attempt, scheduledAt: row.scheduledAt,
  }).catch((e) => console.error("[tasks] run-now failed:", row.id, e?.message ?? e));

  return c.json({ run: row });
});

/**
 * Cancel. A scheduled run stops outright; a running one is marked `cancelling`
 * and the executor stops BETWEEN tasks — never mid-task, which would leave the
 * document half-edited with nothing recording it.
 */
taskRoutes.post("/runs/:runId/cancel", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");

  const [run] = await db.select().from(taskRuns)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId)));
  if (!run) return c.json({ error: "not found" }, 404);

  if (run.status === "scheduled" || run.status === "draft") {
    const [row] = await db.update(taskRuns)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(taskRuns.id, runId)).returning();
    return c.json({ run: row });
  }
  if (run.status === "running") {
    const [row] = await db.update(taskRuns).set({ status: "cancelling" })
      .where(eq(taskRuns.id, runId)).returning();
    return c.json({ run: row, note: "will stop after the task now running" });
  }
  return c.json({ error: "already finished" }, 409);
});

taskRoutes.get("/runs", async (c) => {
  const userId = c.get("userId");
  const thesisId = c.req.query("thesisId");
  if (!thesisId) return c.json({ error: "thesisId required" }, 400);
  const runs = await db.select().from(taskRuns)
    .where(and(eq(taskRuns.userId, userId), eq(taskRuns.thesisId, thesisId)));
  return c.json({ runs });
});

taskRoutes.get("/runs/:runId", async (c) => {
  const userId = c.get("userId");
  const runId = c.req.param("runId");
  const [run] = await db.select().from(taskRuns)
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.userId, userId)));
  if (!run) return c.json({ error: "not found" }, 404);
  const items = await db.select().from(taskTable).where(eq(taskTable.runId, runId)).orderBy(asc(taskTable.position));
  const proposals = await db.select().from(taskProposals).where(eq(taskProposals.thesisId, run.thesisId));
  return c.json({ run, tasks: items, proposals: proposals.filter((p) => items.some((t) => t.id === p.taskId)) });
});
```

- [ ] **Step 4: Mount it**

In `src/index.ts`, after line 117:

```ts
app.route("/api/tasks", taskRoutes);
```

with `import { taskRoutes } from "./routes/tasks";` alongside the other route imports.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd ~/modakerati-server && npx vitest run src/lib/tasks/__tests__/tick-auth.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 6: Reconcile four names against their source files**

Four symbols above are written from the codebase's shape rather than read line by line. Each has one authoritative source — copy from it:

| Symbol | Copy its exact form from |
|---|---|
| `AppVariables`, `c.get("userId")` | `src/routes/chat-threads.ts` (its Hono generic and how it reads the signed-in user) |
| `getProvider()` | `src/lib/ai/index.ts` |
| `readThesisBlocks` | `src/routes/thesis/shared.ts` — reuse the reader the document routes use; do not open the .docx a second way |
| `McpServer` | `src/mcp/tools/docx-blocks.ts` (its import line) |

```bash
cd ~/modakerati-server
npx tsc --noEmit
```

Expected: no errors. Correct the import to match the source file — never loosen the typecheck to match the plan.

- [ ] **Step 7: Commit**

```bash
cd ~/modakerati-server
git add src/routes/tasks.ts src/index.ts src/lib/tasks/__tests__/tick-auth.test.ts
git commit -m "feat(tasks): the tick endpoint and run CRUD

The tick refuses everything when no secret is configured — an open endpoint
that executes AI runs against real theses is worse than a feature that never
fires. Runs are started, not awaited: a cron gets its answer in milliseconds
and the lease protects the row."
```

---

## Task 11: End-to-end — a run that fires with no app connected

The point of the phase. Nothing here is a unit test; this is the thing working.

**Files:**
- Create: `scripts/probe-task-run.ts`

- [ ] **Step 1: Write the probe**

Model it on `scripts/probe-chat-threads.ts` for how it bootstraps env and picks a thesis.

```ts
// scripts/probe-task-run.ts
/**
 * End-to-end: build a run scheduled one minute in the past, tick it, watch it
 * execute with no client attached. Run against a LOCAL database.
 *
 *   npx tsx scripts/probe-task-run.ts
 */
import "dotenv/config";
import { db, taskRuns, tasks as taskTable, taskProposals, theses } from "../src/db";
import { eq } from "drizzle-orm";

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";
const SECRET = process.env.TASKS_TICK_SECRET!;

async function main() {
  const [thesis] = await db.select({ id: theses.id, userId: theses.userId }).from(theses).limit(1);
  if (!thesis) throw new Error("seed a thesis first");

  const [run] = await db.insert(taskRuns).values({
    userId: thesis.userId,
    thesisId: thesis.id,
    title: "probe",
    status: "scheduled",
    scheduledAt: new Date(Date.now() - 60_000),
  }).returning();

  await db.insert(taskTable).values([
    { runId: run.id, position: 0, kind: "fix_captions", params: {}, target: {}, mode: "apply" },
    { runId: run.id, position: 1, kind: "proofread", params: { scope: "the introduction" }, target: {}, mode: "propose" },
  ]);

  console.log("run", run.id, "→ ticking");
  const res = await fetch(`${BASE}/api/tasks/tick`, {
    method: "POST",
    headers: { "x-tasks-secret": SECRET },
  });
  console.log("tick:", res.status, await res.text());

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const [row] = await db.select().from(taskRuns).where(eq(taskRuns.id, run.id));
    console.log(`  ${i * 5}s — ${row.status}`, row.summary ?? "");
    if (row.status === "done" || row.status === "failed") break;
  }

  const items = await db.select().from(taskTable).where(eq(taskTable.runId, run.id));
  for (const t of items) console.log(`  · ${t.kind} [${t.mode}] → ${t.status}`, t.result ?? "");

  const props = await db.select().from(taskProposals).where(eq(taskProposals.thesisId, thesis.id));
  console.log(`  proposals: ${props.length}`);
  for (const p of props) console.log(`    "${p.beforeText.slice(0, 50)}…" → "${p.afterText.slice(0, 50)}…"`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it against a local server**

```bash
cd ~/modakerati-server
export TASKS_TICK_SECRET=dev-secret
npm run dev &
npx tsx scripts/probe-task-run.ts
```

Expected, in order:
- `tick: 200 {"claimed":1}`
- the run moving `running` → `done`
- `fix_captions [apply] → done` with a message
- `proofread [propose] → done`
- **at least one proposal printed, and the document unchanged by that task** — this is the assertion that matters. Open the thesis and confirm the proofread changed nothing.

- [ ] **Step 3: Verify the containment claim by hand**

Temporarily add `"delete_blocks"` to a task's turn by editing the catalogue's `fix_captions.writes`, re-run the probe, and confirm from `ai_tool_log` (by `turn_id`) that the model was offered exactly the declared names. Then revert the edit. `ai_tool_log` is the ground truth here — a model's own account of what it could reach is not.

- [ ] **Step 4: Run the whole suite**

Run: `cd ~/modakerati-server && npx vitest run --testTimeout=60000`
Expected: PASS. A timeout is not a failure until it has been re-run with this flag.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add scripts/probe-task-run.ts
git commit -m "test(tasks): probe a scheduled run end to end with no client attached"
```

---

## Task 12: The cron, and the deploy note

- [ ] **Step 1: Generate a secret and set it**

```bash
openssl rand -hex 24
```

Add to the server `.env` and to the Octenium environment:

```
TASKS_TICK_SECRET=<the value>
TASKS_MAX_TOKENS=400000
```

- [ ] **Step 2: Add the cPanel cron**

Every minute:

```bash
curl -fsS -X POST https://modakerati.greenpedal.net/api/tasks/tick -H "x-tasks-secret: <the value>" > /dev/null 2>&1
```

- [ ] **Step 3: Record it where it will be found again**

Append to the deploy notes in `~/modakerati-server/docs/` (the file the Octenium steps already live in):

```markdown
### Tasks tick cron

`POST /api/tasks/tick` every minute, header `x-tasks-secret: $TASKS_TICK_SECRET`.

This is not only the scheduler — it is also the keep-alive that stops Passenger
idling the app out, which is exactly why an in-process timer was rejected.

⚠️ The existing warning still applies: **delete the crons before stopping the
app** if the fork ceiling returns.
```

- [ ] **Step 4: Verify it fires in production**

```bash
curl -i -X POST https://modakerati.greenpedal.net/api/tasks/tick -H "x-tasks-secret: $TASKS_TICK_SECRET"
```

Expected: `200 {"claimed":0}`. Then, without the header:

```bash
curl -i -X POST https://modakerati.greenpedal.net/api/tasks/tick
```

Expected: `401`. Confirm both before considering this done.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati-server
git add docs/
git commit -m "docs(tasks): the tick cron, and why it is also the keep-alive"
```

---

## Done when

- `npx vitest run --testTimeout=60000` passes in `~/modakerati-server`
- `npx tsc --noEmit` passes
- `scripts/probe-task-run.ts` shows a run executing with no client attached, an apply task changing the document and a propose task changing nothing while writing proposals
- `POST /api/tasks/runs/:id/run-now` executes the same run without a tick
- `POST /api/tasks/runs/:id/cancel` on a running run leaves it `cancelling`, and it stops after the task in flight — not mid-task
- The production tick returns 200 with the secret and 401 without it

A run whose process dies is not failed by the executor — it is left `running` with a lease, and `releaseExpired()` re-offers it once before failing it. That path is covered by Task 8's test, not by the probe.

Phase 2 (the app: drawer destination, Up next list, *Add as task*, scheduling, the report) and phase 3 (reviewing proposals in the document) follow in their own plans.
