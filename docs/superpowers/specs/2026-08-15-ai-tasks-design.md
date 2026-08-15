# Tasks — a scheduled work queue for the AI

**Date:** 2026-08-15
**Status:** design approved, not yet planned

## The idea

A student builds a list of things for Kwill to do to their thesis, sets a time,
and closes the app. The work happens on the server while they sleep. A push
notification tells them what got done, what needs their eye, and what couldn't be
done.

Everything the AI does today exists only because a phone is holding a streaming
connection open. This is the first feature that runs with nobody there, and that
single fact drives almost every decision below.

## Why this shape

Four decisions were made before the design, and the rest follows from them.

**It is a background agent, not a batch button.** The student schedules; the
server runs. That rules out any design where the AI asks a question mid-run,
because there is nobody to answer it.

**It never asks.** Queueing a task *is* the authorization — the destructive-tool
gate is pre-satisfied for tasks. A task too ambiguous to do well is abandoned
with a written reason and the run continues to the next one. This is not a
shortcut: `destructive-gate.ts` already records that a gate ends the turn, which
is why a bulk clean-up could never finish in one go. Undo is the History
snapshot, not a prompt.

**Tasks come from a menu, not a text box.** Each task is a known job with typed
parameters. A job declares the exact tool set it may use, so a 2am run executes a
recipe instead of improvising. The one exception is a task anchored to a block
the student selected in the editor — there, free text is safe because the scope
is unambiguous.

**One list is one scheduled run.** One `when`, one notification, one History
checkpoint. Recurring runs are a later feature that this model can absorb without
redesign.

## The model

A **run** is one scheduled job against one thesis: a title, a `scheduled_at`, and
an ordered list of tasks. It moves `draft → scheduled → running → done | failed`.

A **task** is either:

- a **catalogue job** — an id (`fix_captions`, `proofread`, …) plus typed params
  (which chapter, which language, which norm profile); or
- a **block task** — free text plus an anchor captured from an editor selection.

Both carry `mode: "apply" | "propose"`. The default comes from the job family;
the student can flip any task, or the whole run.

- **apply** — the task's tools commit to the document.
- **propose** — the task runs with no mutating tools and a single `propose_edit`
  tool, which writes a reviewable row instead of changing anything.

### Tables

Hand-written SQL. drizzle-kit is unusable in this project.

**`task_runs`** — `user_id`, `thesis_id`, `title`, `status`, `scheduled_at`,
`started_at`, `finished_at`, `lease_until`, `attempt`, `history_checkpoint`,
`summary`.

**`tasks`** — `run_id`, `position`, `kind`, `params` (jsonb), `target` (jsonb:
scope + anchor), `mode`, `status`, `result` (jsonb: what changed, or why it
didn't), timestamps.

**`task_proposals`** — `task_id`, `thesis_id`, `anchor` (block index **+ text
snippet + label**), `action`, `before_text`, `after_text`,
`status: pending | accepted | rejected | stale`.

`task_proposals` is genuinely new infrastructure. Suggestions today are
client-side only — a Zustand store keyed by block index, produced by a live
stream, never persisted (`stores/suggestion-store.ts`). Nothing survives the app
closing, so a background run has nowhere to put a proposal. The *review UI* is
reused; the storage is not.

## The runner

Triggered by an external cron ping, executed in the server process.

A cPanel cron (Octenium already runs crons) hits an authed `/tasks/tick` once a
minute. Scheduling lives outside the app process, so a restart cannot lose it,
and the ping doubles as the keep-alive that stops Passenger idling the app out —
which is exactly what would kill an in-process timer at 3am.

Per tick:

1. Claim due runs with a guarded
   `UPDATE … WHERE status='scheduled' AND scheduled_at <= now() … RETURNING`,
   setting `lease_until`. A double-ping cannot run a job twice.
2. Take `withThesisLock`.
3. Write **one** History checkpoint for the whole run.
4. For each task in order: one bounded `runToolLoop` call, preloaded with **only
   that job's declared tools**, with its own step and cost cap.
5. A failed task records its reason and the run continues.
6. Release the lock, write the summary, send one push.

A crashed run whose lease expires is retried once, then marked failed. The retry
**resumes at the first task not already `done`** — per-task status is persisted
precisely so a retry cannot re-apply work that already landed.

The catalogue earns its keep here. Because a job's tool set is known before the
run starts, there is no `load_tools` churn mid-run — which matters, since a
mid-turn tool change rewrites the whole prompt-cache prefix. And a job cannot
reach a tool it did not declare, which is stronger containment than the
destructive gate ever provided.

### Who pays

Background runs use platform keys and belong to paid tiers. A free-tier BYOK
student's key exists only inside a request — `byok.ts` is explicit that it is
never persisted — so at 2am there is nothing to call the model with. BYOK
students get the entire feature except the clock: the same lists, run with **Run
now** while the app is open, where their key rides the request as it does today.
No provider key is stored at rest.

**Run now** is the same run row and the same executor, invoked inline from the
request instead of from a tick. It skips only the claim step, and it streams
per-task progress to the open app rather than ending in a push. There is one
execution path, not two.

## The v1 menu

| Family | Jobs | Default mode |
|---|---|---|
| Hygiene | `fix_captions` · `rebuild_toc` · `build_figure_and_table_lists` | apply |
| Formatting | `apply_norms` · `fix_heading_levels` · `unify_typography` | apply |
| Language | `proofread` · `remove_repetition` · `write_abstract` | propose |
| Content | `draft_section` | propose |
| — | `custom_block_task` (free text, anchored) | propose |

Every id is verified against `~/modakerati-server/docs/ai-tool-catalogue.md`
during planning. A job that cannot be assembled from tools that already exist
does not ship in v1.

## The app

**Tasks is a destination in the nav drawer**, opening a full screen.

**Adding stays one tap from anywhere.** The block bubble gets *Add as task*: it
captures the selection as an anchor, drops the task into the next run, and shows
a toast. No navigation, and never a "which run?" question.

**The screen is one list that fills up.** There is always exactly one **Up next**
run collecting tasks. Set a time, tap Schedule, and a fresh empty one takes its
place. Finished runs stack underneath as history.

**A "Needs you" band pins to the top** only when a finished run has proposals
waiting or tasks that failed, and collapses when it is empty.

**Reviewing happens in the document.** Proposals sit on the real paragraphs using
the existing inline card and word-diff, with a stepper pill counting them down
and jumping to the next so none is missed. A rewrite is only judgeable with the
page around it.

**The report lives in Tasks** and owns what the document cannot show: what was
applied, what failed and why, and the undo.

**Bulk actions.** *Approve all* / *Reject all* act on pending proposals, from
either the report or the stepper. Accepting routes through the durable op queue
via `useThesisDocStore.mutate`, exactly like a manual edit, so an accepted
proposal reconciles and flushes the same way everything else does. *Undo the run*
restores the pre-run History
checkpoint — which rolls back applied tasks **and** any proposals already
accepted, since those are now ordinary document text; pending proposals are
voided. The report states this before the student confirms.

## Edges

**Index drift.** Blocks have no stable id, and a task written at 21:00 runs at
23:00 against a document that may have shifted. Block tasks and proposals store
index **+ snippet + label** and re-resolve by content at run time, following
`lib/block-links.ts`. No match → the task fails with a reason; a proposal whose
anchor is gone becomes `stale` and appears in the report rather than landing on
the wrong paragraph.

**The student opens the app mid-run.** The run holds `withThesisLock`, so edits
cannot interleave — but the app's optimistic ops are built on pre-run indices and
flushing them afterwards would write to the wrong blocks. So the writer is
**read-only behind a banner** while a run executes on that thesis, and refetches
when the lock releases. This is the least pleasant part of the design and the
first thing to revisit if runs turn out to be long.

**One run at a time per thesis.** A second scheduled run waits its turn.

**A missed window.** Server down at 23:00 → the next tick claims and runs it
late, and the report says it ran late rather than pretending otherwise.

**Cost.** A per-run ceiling. Hitting it stops the run cleanly and the report
names the tasks that were never attempted. No silent truncation.

**Cancelling.** A scheduled run can be cancelled; a running one stops between
tasks.

**Timezones.** `scheduled_at` is a `timestamptz` computed from the device's
timezone when the run is scheduled.

**Trilingual copy.** Job names, notification text and report strings are edited
**surgically** into the locale JSONs. Those files carry ~155 duplicate keys each
and a `json.load`/`json.dump` round-trip silently eats them.

## Verification

Server (vitest):

- the claim query cannot double-claim under two concurrent ticks
- anchor re-resolution against a deliberately drifted document
- **a job cannot invoke a tool it did not declare**
- propose-mode writes `task_proposals` rows and mutates no document
- step and cost caps stop a run and record what was skipped
- a run continues past a failed task

App: `npx tsc --noEmit`. There is no JS test runner in this repo.

## Build order

Too large for one plan. Three, in this order, each shippable on its own:

1. **Server foundation** — the three tables, the claim-and-lease tick, the
   executor, per-job tool sets, `propose_edit`, the push. Verified by vitest and
   a scheduled run against a real thesis with no app involved.
2. **App — authoring and running** — the drawer destination, the Up next list,
   *Add as task* on the block bubble, scheduling, Run now, the report.
3. **App — reviewing** — proposals on real paragraphs, the stepper pill, approve
   all / reject all, undo the run.

## Not in v1

Recurring runs · deadline-driven scheduling · per-task undo · background runs on
BYOK keys · supervisor visibility.

## Relationship to existing work

Roadmap item #11, "Deadlines and milestones", is the *student's* own to-do list.
This is its inverse — a work queue for the AI. They will want to look alike and
should stay separate features.
