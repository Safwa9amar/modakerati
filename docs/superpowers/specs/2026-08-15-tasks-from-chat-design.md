# Scheduling a task from chat

**Date:** 2026-08-15
**Status:** design approved, not yet planned
**Extends:** `2026-08-15-ai-tasks-design.md` (Tasks). Phase 1 shipped (server v1.15.0); phase 2 built, unshipped.

## The idea

A student says *"proofread chapter 2 tonight"* in chat and it is queued for 23:00,
without them opening the Tasks screen.

## Why this is not simply "give the AI the tool"

The chat AI can already do every job on the menu, immediately, with the ~100
tools it holds. The thing it cannot do is act at 2am. So this feature is not
about capability — it is about teaching the assistant **when to defer instead of
act**, and the failure mode runs both ways:

- Too eager, and a student asking for a small fix is told "I've scheduled it for
  tonight" instead of getting it done.
- Too reluctant, and the feature never fires at all.

**The rule: queue only when the student names a time.** "Proofread chapter 2
tonight" is queued. "Proofread chapter 2" is done now, as it is today. The
trigger is the student expressing *when* — unambiguous, requires no judgement,
and is exactly the gap a live turn cannot fill.

## What gets built

### One tool: `schedule_task`

Registered in `src/mcp/tools/tasks.ts` beside `propose_edit`, but unlike it,
**visible in ordinary chat**.

| Arg | |
|---|---|
| `job` | a catalogue job id (`src/lib/tasks/catalogue.ts`) |
| `params` | that job's declared params (e.g. `scope`) |
| `mode` | `apply` \| `propose` — optional, defaults from the job's family |
| `when` | `in_an_hour` \| `tonight` \| `late_tonight` \| `tomorrow_morning` |

**A time outside those four is not silently rounded.** If the student says
"Friday" or "in three days", the assistant says what it can offer and asks which
they want, rather than quietly scheduling the nearest preset. Scheduling an
unattended document edit at a time nobody chose is worse than one more exchange.

It creates a **new scheduled run** containing exactly that one task, and returns
the resolved local time plus the run id.

**It never touches the draft "Up next" run.** A conversation can name two
different times, and a run has one; more importantly, scheduling the draft would
send whatever the student was still assembling on the Tasks screen — work they
never asked to run. Several scheduled runs per thesis already work: they
serialise on the thesis lock.

Placed in the **core** tool set, not the on-demand tail. A model that must first
realise it should `load_tools` for a "tasks" group will simply do the work now
instead, and the feature dies silently with no error to notice.

### The timezone — the one piece of new plumbing

There is **no timezone signal anywhere on the server**, and the chat request does
not carry one. "Tonight at 23:00" is therefore unresolvable server-side today.

`chatSendStream` (`lib/api.ts`) gains one field:

```ts
tzOffsetMinutes: -new Date().getTimezoneOffset()   // Algiers → 60
```

The chat route puts it on the turn context so tools can read it. One field, and
it unlocks anything time-aware later.

### Preset resolution, ported

`src/lib/tasks/schedule.ts` (server) mirrors the app's `lib/task-schedule.ts`:
the four presets, and the rule that **an hour already past rolls forward a day**
— otherwise "tonight 23:00" asked at 23:30 schedules a run into the past, which
the very next tick claims and runs immediately.

This duplicates ~30 lines across two repos. They cannot share a module, and the
alternative — having the app compute the timestamp — puts the decision in the
wrong place, since the AI is the one choosing the time. Duplicate honestly.

### The prompt rule

The `types.ts` catalogue describes `schedule_task` and states the rule: use it
**only** when the student names a time; otherwise do the work now.

⚠️ `types.ts` is one big template literal. A stray backtick breaks the build and
vitest blames a dozen unrelated suites.

### No confirmation gate

Scheduling destroys nothing and Cancel undoes it. A gate here is exactly the
friction `destructive-gate.ts` already documents as counter-productive.

Instead the assistant **must state the resolved absolute time** — "scheduled for
tonight at 23:00" — so a misparse is visible in the same breath rather than at
2am.

## Registries

A tool touches four, plus the snapshot test:

1. `src/mcp/tools/tasks.ts` — register it
2. `LIVE_DOCX_TOOLS` (`mcp-tool-sets.ts`) — gate it
3. `types.ts` — the prompt catalogue
4. `TOOL_GROUPS` — not needed here; it is core, not on-demand
5. `EXPECTED_TOOLS` (`src/mcp/__tests__/tool-registry.test.ts`) — update in the
   same commit, as that test asks

## Verification

Server vitest:

- preset resolution across timezone offsets, including the roll-forward rule
- the tool creates exactly ONE run and ONE task, and leaves the draft untouched
- an unknown job id is refused rather than guessed
- a missing `tzOffsetMinutes` resolves in UTC and the tool's RETURN VALUE says
  so, so the assistant states a time the student can sanity-check — rather than
  silently scheduling an hour wrong for an older app build that predates the
  field

App: `npx tsc --noEmit`, plus asking the assistant "proofread the introduction
tonight" against a real thesis and confirming a scheduled run appears in Tasks
at the right hour.

## Not in this change

Listing or cancelling runs from chat. The student can already see and cancel
them on the Tasks screen, and each extra tool is another prompt rule to get
right. Worth revisiting once the create path has been used in anger.
