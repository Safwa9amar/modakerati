# Tasks — App: Authoring and Running Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can build a task list for their thesis, schedule it or run it now, and read what happened — from the drawer, and from one tap on any block they're looking at.

**Architecture:** A Tasks destination in the nav drawer over a Zustand store that mirrors the phase-1 server. There is always exactly one **draft** run per thesis ("Up next"), so "Add as task" never has to ask *which run*. Scheduling uses preset chips, not a picker — see the note below. Reviewing proposals is phase 3 and is deliberately absent here.

**Tech Stack:** Expo (v56 — read the versioned docs), React Native, expo-router, Zustand, `@gorhom/bottom-sheet`, react-i18next.

**Spec:** `docs/superpowers/specs/2026-08-15-ai-tasks-design.md`
**Depends on:** phase 1, branch `feat/tasks-server` in `~/modakerati-server` (merged or running locally).

---

## Two constraints that shape everything below

**There is no JS test runner in this repo.** Not a gap to fill — a fact to design around. Every task below verifies with `npx tsc --noEmit` **plus a named on-device check**. A task is not done because it compiles.

**No date/time picker is installed, and adding one would break OTA.** `@react-native-community/datetimepicker` is a native module; adding it changes the fingerprint, and `runtimeVersion` is `{"policy":"fingerprint"}` — every installed binary would stop being offered updates until it was rebuilt and reinstalled. So scheduling is **preset chips** ("Tonight 23:00", "Tomorrow 08:00", …), which keeps phase 2 a JS-only change shippable over `publish-update.sh`. It is also better on a phone than a spinner. A custom-time picker can come later, in a release that is rebuilding anyway.

---

## File structure

**Create**

| File | Responsibility |
|---|---|
| `lib/tasks-api.ts` | The nine endpoints + their types. Nothing else. |
| `lib/task-schedule.ts` | Pure. Preset → concrete `Date` in the device's timezone, and its label. |
| `stores/tasks-store.ts` | The Up next run, its tasks, and the run list. One concern. |
| `app/(app)/tasks.tsx` | The screen: Needs-you band, Up next, history. |
| `app/(app)/task-run.tsx` | One run's report. |
| `components/tasks/JobPickerSheet.tsx` | Pick a job from the menu; collect its params. |
| `components/tasks/ScheduleSheet.tsx` | Preset chips + Schedule / Run now. |
| `components/tasks/TaskRow.tsx` | One task line, shared by the screen and the report. |
| `components/tasks/AddBlockTaskSheet.tsx` | "Add as task" for the selected paragraph. |
| `components/tasks/RunningBanner.tsx` | "Kwill is working" strip in the Writer. |
| `components/skeletons/TasksSkeleton.tsx` | Layout-shaped loading state. Owns its own single pulse. |

**Modify**

- `lib/api.ts` — export the four private request helpers so `tasks-api.ts` can reuse them
- `components/AppDrawer.tsx:279` — a Tasks row beside Library/News
- `components/workspace/BlockContextBar.tsx` — an "Add as task" chip next to ✦
- `app/(app)/thesis-workspace.tsx` — the running banner + a refetch when a run ends
- `locales/en.json`, `locales/fr.json`, `locales/ar.json` — new keys, **edited surgically**

**Why `lib/tasks-api.ts` and not `lib/api.ts`:** that file is 2243 lines. Adding a tenth feature's endpoints to it makes it worse, and the tasks client is genuinely self-contained. The four request helpers are module-private today, so Task 1 exports them — a four-word change, not a restructure.

⚠️ **The locale JSONs carry ~155 duplicate keys each.** Never load-and-dump them. Insert new keys with a targeted edit against an anchor string, and re-read the file to confirm nothing else moved.

---

## Task 1: The API client

**Files:**
- Modify: `lib/api.ts:96`, `:237`, `:264`, `:277`
- Create: `lib/tasks-api.ts`

- [ ] **Step 1: Export the four request helpers**

In `lib/api.ts`, add `export` to each of these four declarations, changing nothing else about them:

```ts
export async function apiGet<T>(path: string): Promise<T> {
```
```ts
export async function apiPost<T>(path: string, body: any, signal?: AbortSignal): Promise<T> {
```
```ts
export async function apiPatch<T>(path: string, body: any): Promise<T> {
```
```ts
export async function apiDelete(path: string): Promise<void> {
```

- [ ] **Step 2: Write the client**

```ts
// lib/tasks-api.ts
import { apiGet, apiPost, apiDelete } from "./api";

/**
 * Scheduled tasks — the student queues jobs, picks a time, and the server runs
 * them with the app closed. Mirrors ~/modakerati-server/src/routes/tasks.ts.
 *
 * Deliberately separate from lib/api.ts, which is already 2243 lines: this is a
 * self-contained surface and reads better on its own.
 */

export type TaskMode = "apply" | "propose";
export type TaskFamily = "hygiene" | "formatting" | "language" | "content";

/** A job on the menu, as the server describes it. */
export interface JobDef {
  id: string;
  family: TaskFamily;
  /** Param names this job needs the student to supply, e.g. ["scope"]. */
  params: string[];
  defaultMode: TaskMode;
}

export interface TaskTarget {
  /** A human label — "الفصل الثاني". Never an index. */
  scope?: string;
  anchor?: { index: number; snippet: string };
}

export interface TaskItem {
  id: string;
  runId: string;
  position: number;
  kind: string;
  params: Record<string, string>;
  target: TaskTarget;
  mode: TaskMode;
  status: "pending" | "done" | "failed" | "skipped";
  result?: { message: string; reason?: string } | null;
}

export interface RunSummary {
  applied: number;
  proposed: number;
  failed: number;
  stoppedForBudget?: boolean;
  lateMinutes?: number;
}

export interface TaskRun {
  id: string;
  thesisId: string;
  title: string;
  status: "draft" | "scheduled" | "running" | "cancelling" | "done" | "failed" | "cancelled";
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  summary: RunSummary | null;
  createdAt: string;
}

export interface TaskProposal {
  id: string;
  taskId: string;
  anchor: { index: number; snippet: string; label?: string };
  beforeText: string;
  afterText: string;
  note: string;
  status: "pending" | "accepted" | "rejected" | "stale";
}

export async function listJobs(): Promise<JobDef[]> {
  const r = await apiGet<{ jobs: JobDef[] }>("/api/tasks/jobs");
  return r.jobs;
}

/** The one draft run collecting tasks for this thesis. Created on demand. */
export async function nextRun(thesisId: string): Promise<{ run: TaskRun; tasks: TaskItem[] }> {
  return apiGet(`/api/tasks/runs/next?thesisId=${encodeURIComponent(thesisId)}`);
}

export async function addTask(
  runId: string,
  input: { kind: string; params?: Record<string, string>; target?: TaskTarget; mode?: TaskMode },
): Promise<TaskItem> {
  const r = await apiPost<{ task: TaskItem }>(`/api/tasks/runs/${runId}/tasks`, input);
  return r.task;
}

export async function removeTask(taskId: string): Promise<void> {
  return apiDelete(`/api/tasks/tasks/${taskId}`);
}

/** `scheduledAt` is an ISO string built from the DEVICE's clock — see lib/task-schedule.ts. */
export async function scheduleRun(runId: string, scheduledAt: string, title?: string): Promise<TaskRun> {
  const r = await apiPost<{ run: TaskRun }>(`/api/tasks/runs/${runId}/schedule`, { scheduledAt, title });
  return r.run;
}

export async function runNow(runId: string): Promise<TaskRun> {
  const r = await apiPost<{ run: TaskRun }>(`/api/tasks/runs/${runId}/run-now`, {});
  return r.run;
}

export async function cancelRun(runId: string): Promise<TaskRun> {
  const r = await apiPost<{ run: TaskRun }>(`/api/tasks/runs/${runId}/cancel`, {});
  return r.run;
}

export async function listRuns(thesisId: string): Promise<TaskRun[]> {
  const r = await apiGet<{ runs: TaskRun[] }>(`/api/tasks/runs?thesisId=${encodeURIComponent(thesisId)}`);
  return r.runs;
}

export async function getRun(
  runId: string,
): Promise<{ run: TaskRun; tasks: TaskItem[]; proposals: TaskProposal[] }> {
  return apiGet(`/api/tasks/runs/${runId}`);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Prove it talks to the real server**

Start the server (`cd ~/modakerati-server && npm run dev`), then from the app repo:

```bash
cd ~/modakerati && node -e '
fetch("http://localhost:3000/api/tasks/jobs").then(r=>console.log("jobs:",r.status))
'
```

Expected: `jobs: 401` — the endpoint exists and is protected. A `404` means the server is on `master` and phase 1 has not been merged or checked out; switch to `feat/tasks-server` before continuing.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati
git add lib/api.ts lib/tasks-api.ts
git commit -m "feat(tasks): the app's client for the scheduled-tasks API

Its own module rather than a tenth feature bolted onto a 2243-line api.ts;
the four request helpers are exported so it reuses the auth/error plumbing
instead of duplicating it."
```

---

## Task 2: Schedule presets

Pure module. No picker library — see the constraint at the top of this plan.

**Files:**
- Create: `lib/task-schedule.ts`

- [ ] **Step 1: Write it**

```ts
// lib/task-schedule.ts
/**
 * When a run should fire, as a handful of choices rather than a picker.
 *
 * WHY NOT A DATE/TIME PICKER
 * --------------------------
 * @react-native-community/datetimepicker is a NATIVE module. Adding it changes
 * the fingerprint, and runtimeVersion is {"policy":"fingerprint"} — every
 * installed binary would stop being offered OTA updates until rebuilt and
 * reinstalled. Presets keep this feature JS-only and shippable over the air,
 * and on a phone they beat a spinner anyway.
 *
 * All arithmetic is on the DEVICE's clock, so "tonight" means tonight where the
 * student is. The server stores what we send as a timestamptz.
 *
 * PURE MODULE — no React, no IO.
 */

export type SchedulePresetId = "in_an_hour" | "tonight" | "late_tonight" | "tomorrow_morning";

export interface SchedulePreset {
  id: SchedulePresetId;
  /** i18n key under `tasks.when`. */
  labelKey: string;
  /** Hour of day in local time, or null for a relative offset. */
  hour: number | null;
  /** Days ahead. 0 = today, 1 = tomorrow. Ignored when `hour` is null. */
  dayOffset: number;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: "in_an_hour", labelKey: "tasks.when.inAnHour", hour: null, dayOffset: 0 },
  { id: "tonight", labelKey: "tasks.when.tonight", hour: 23, dayOffset: 0 },
  { id: "late_tonight", labelKey: "tasks.when.lateTonight", hour: 2, dayOffset: 1 },
  { id: "tomorrow_morning", labelKey: "tasks.when.tomorrowMorning", hour: 8, dayOffset: 1 },
];

/**
 * The concrete moment a preset means, from `now` (injected so this stays pure
 * and so the caller can be tested against a fixed clock).
 *
 * A fixed-hour preset that has already passed today rolls to tomorrow — picking
 * "Tonight 23:00" at 23:30 must not schedule a run 30 minutes in the past, which
 * the server would claim on the very next tick and run immediately.
 */
export function resolvePreset(preset: SchedulePreset, now: Date = new Date()): Date {
  if (preset.hour === null) return new Date(now.getTime() + 60 * 60 * 1000);

  const d = new Date(now);
  d.setDate(d.getDate() + preset.dayOffset);
  d.setHours(preset.hour, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

/** "23:00" for the chip's subtitle. 24-hour: what Algerian students read. */
export function presetClock(preset: SchedulePreset, now: Date = new Date()): string {
  const d = resolvePreset(preset, now);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Check the rollover by hand**

There is no test runner, so verify the one rule that is easy to get wrong:

```bash
cd ~/modakerati && npx tsx -e '
import { SCHEDULE_PRESETS, resolvePreset } from "./lib/task-schedule";
const tonight = SCHEDULE_PRESETS.find(p => p.id === "tonight")!;
const late = new Date("2026-08-15T23:30:00");
console.log("picked at 23:30 →", resolvePreset(tonight, late).toString());
const early = new Date("2026-08-15T09:00:00");
console.log("picked at 09:00 →", resolvePreset(tonight, early).toString());
'
```

Expected: the 23:30 case resolves to **16 Aug 23:00** (rolled forward), the 09:00 case to **15 Aug 23:00**. A past date here means the server would claim the run on its next tick and fire it immediately.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add lib/task-schedule.ts
git commit -m "feat(tasks): schedule presets, not a picker

A native date picker would change the fingerprint and cut every installed
binary off from OTA updates. Presets keep this JS-only — and a preset that
has already passed today rolls to tomorrow, so 'Tonight' picked at 23:30
never schedules a run into the past."
```

---

## Task 3: The store

**Files:**
- Create: `stores/tasks-store.ts`

- [ ] **Step 1: Write it**

```ts
// stores/tasks-store.ts
import { create } from "zustand";
import {
  listJobs, nextRun, addTask, removeTask, scheduleRun, runNow, cancelRun, listRuns,
  type JobDef, type TaskRun, type TaskItem, type TaskTarget, type TaskMode,
} from "@/lib/tasks-api";

/**
 * The student's task queue for one thesis: the single draft run collecting
 * tasks ("Up next"), and the runs that already happened.
 *
 * There is always exactly ONE draft run per thesis — the server creates it on
 * demand. That is what lets "Add as task" from a block land somewhere without
 * ever asking "which run?".
 *
 * ⚠️ Select PRIMITIVES from this store. `useTasksStore(s => ({a: s.a}))` builds
 * a fresh object every render and throws "Maximum update depth exceeded".
 */

// Stable empty arrays — a fresh `[]` from a selector is a new snapshot every
// render, which is the same crash.
const EMPTY_TASKS: TaskItem[] = [];
const EMPTY_RUNS: TaskRun[] = [];

interface TasksState {
  thesisId: string | null;
  jobs: JobDef[];
  draft: TaskRun | null;
  tasks: TaskItem[];
  runs: TaskRun[];
  loading: boolean;
  busy: boolean;

  load: (thesisId: string) => Promise<void>;
  refresh: () => Promise<void>;
  add: (input: { kind: string; params?: Record<string, string>; target?: TaskTarget; mode?: TaskMode }) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
  schedule: (whenIso: string, title?: string) => Promise<void>;
  start: () => Promise<void>;
  cancel: (runId: string) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  thesisId: null,
  jobs: [],
  draft: null,
  tasks: EMPTY_TASKS,
  runs: EMPTY_RUNS,
  loading: false,
  busy: false,

  load: async (thesisId) => {
    set({ loading: true, thesisId });
    try {
      const [jobs, next, runs] = await Promise.all([listJobs(), nextRun(thesisId), listRuns(thesisId)]);
      set({
        jobs,
        draft: next.run,
        tasks: next.tasks,
        // Newest first; the draft is shown separately as "Up next".
        runs: runs
          .filter((r) => r.status !== "draft")
          .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")),
        loading: false,
      });
    } catch {
      // Best-effort: the last good list stays on screen, same convention as
      // outline-store.sync and chat-threads-store.load.
      set({ loading: false });
    }
  },

  refresh: async () => {
    const id = get().thesisId;
    if (id) await get().load(id);
  },

  add: async (input) => {
    const { draft } = get();
    if (!draft) return;
    set({ busy: true });
    try {
      const task = await addTask(draft.id, input);
      set({ tasks: [...get().tasks, task] });
    } finally {
      set({ busy: false });
    }
  },

  remove: async (taskId) => {
    const before = get().tasks;
    // Optimistic: the row disappears on tap. Restored if the server refuses.
    set({ tasks: before.filter((t) => t.id !== taskId) });
    try {
      await removeTask(taskId);
    } catch {
      set({ tasks: before });
    }
  },

  schedule: async (whenIso, title) => {
    const { draft, thesisId } = get();
    if (!draft || !thesisId) return;
    set({ busy: true });
    try {
      await scheduleRun(draft.id, whenIso, title);
      // Reload rather than patch: scheduling retires the draft and the server
      // mints a fresh empty one, which only a reload can see.
      await get().load(thesisId);
    } finally {
      set({ busy: false });
    }
  },

  start: async () => {
    const { draft, thesisId } = get();
    if (!draft || !thesisId) return;
    set({ busy: true });
    try {
      await runNow(draft.id);
      await get().load(thesisId);
    } finally {
      set({ busy: false });
    }
  },

  cancel: async (runId) => {
    set({ busy: true });
    try {
      await cancelRun(runId);
      await get().refresh();
    } finally {
      set({ busy: false });
    }
  },
}));

/** Runs holding something the student must deal with. Drives the "Needs you" band. */
export function needsYou(runs: TaskRun[]): TaskRun[] {
  return runs.filter(
    (r) => r.status === "done" && ((r.summary?.proposed ?? 0) > 0 || (r.summary?.failed ?? 0) > 0),
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add stores/tasks-store.ts
git commit -m "feat(tasks): the store for one thesis's queue

Exactly one draft run, created on demand by the server — which is what lets
'Add as task' from a block land somewhere without asking which run."
```

---

## Task 4: The i18n keys

Do this before the UI so no screen ships with `defaultValue` strings that never reach ar/fr.

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Read the anchor in each file**

```bash
cd ~/modakerati && grep -n '"library": {' locales/en.json locales/fr.json locales/ar.json
```

Note the line number in each. You will insert immediately **before** that line.

⚠️ These files contain ~155 duplicate keys each. **Never** `json.load` / `json.dump` them, and never reformat — a round-trip silently drops the duplicates. Use a targeted string insertion only.

- [ ] **Step 2: Insert the English block**

In `locales/en.json`, immediately before the line matched above, insert:

```json
  "tasks": {
    "title": "Tasks",
    "upNext": "Up next",
    "earlier": "Earlier",
    "needsYou": "Needs you",
    "empty": "Nothing queued yet",
    "emptyHint": "Add something for Kwill to do while you're away.",
    "addTask": "Add a task",
    "addFromBlock": "Add as task",
    "scheduleRun": "Schedule this run",
    "runNow": "Run now",
    "cancel": "Cancel run",
    "cancelling": "Stopping after the current task",
    "remove": "Remove",
    "modeApply": "apply",
    "modePropose": "propose",
    "running": "Working…",
    "scheduled": "Scheduled",
    "done": "Done",
    "failed": "Couldn't be done",
    "skipped": "Not attempted",
    "waitingForYou": "waiting for you",
    "ranLate": "Ran late",
    "stoppedEarly": "Stopped early",
    "when": {
      "heading": "When should this run?",
      "inAnHour": "In an hour",
      "tonight": "Tonight",
      "lateTonight": "Late tonight",
      "tomorrowMorning": "Tomorrow morning"
    },
    "jobs": {
      "fix_captions": "Fix captions",
      "rebuild_toc": "Rebuild the table of contents",
      "build_figure_and_table_lists": "Build the lists of figures and tables",
      "apply_norms": "Apply my university's norms",
      "fix_heading_levels": "Fix heading levels",
      "unify_typography": "Unify fonts and spacing",
      "proofread": "Proofread",
      "remove_repetition": "Remove repetition",
      "write_abstract": "Write the abstract",
      "draft_section": "Draft a section",
      "custom_block_task": "Something else"
    },
    "params": {
      "scope": "Which part?",
      "scopePlaceholder": "e.g. chapter 2",
      "normProfile": "Which norms?",
      "languages": "Which languages?",
      "request": "What should Kwill do?"
    }
  },
```

- [ ] **Step 3: Insert the French block**

Same position in `locales/fr.json`:

```json
  "tasks": {
    "title": "Tâches",
    "upNext": "À suivre",
    "earlier": "Précédentes",
    "needsYou": "À votre attention",
    "empty": "Rien en attente",
    "emptyHint": "Ajoutez quelque chose à faire pendant votre absence.",
    "addTask": "Ajouter une tâche",
    "addFromBlock": "Ajouter comme tâche",
    "scheduleRun": "Planifier",
    "runNow": "Lancer maintenant",
    "cancel": "Annuler",
    "cancelling": "Arrêt après la tâche en cours",
    "remove": "Retirer",
    "modeApply": "appliquer",
    "modePropose": "proposer",
    "running": "En cours…",
    "scheduled": "Planifiée",
    "done": "Terminé",
    "failed": "Impossible",
    "skipped": "Non tentée",
    "waitingForYou": "en attente de vous",
    "ranLate": "Exécutée en retard",
    "stoppedEarly": "Arrêtée avant la fin",
    "when": {
      "heading": "Quand faut-il l'exécuter ?",
      "inAnHour": "Dans une heure",
      "tonight": "Ce soir",
      "lateTonight": "Cette nuit",
      "tomorrowMorning": "Demain matin"
    },
    "jobs": {
      "fix_captions": "Corriger les légendes",
      "rebuild_toc": "Reconstruire la table des matières",
      "build_figure_and_table_lists": "Créer les listes des figures et tableaux",
      "apply_norms": "Appliquer les normes de mon université",
      "fix_heading_levels": "Corriger les niveaux de titres",
      "unify_typography": "Uniformiser polices et espacements",
      "proofread": "Relire",
      "remove_repetition": "Supprimer les répétitions",
      "write_abstract": "Rédiger le résumé",
      "draft_section": "Rédiger une section",
      "custom_block_task": "Autre chose"
    },
    "params": {
      "scope": "Quelle partie ?",
      "scopePlaceholder": "ex. chapitre 2",
      "normProfile": "Quelles normes ?",
      "languages": "Quelles langues ?",
      "request": "Que doit faire Kwill ?"
    }
  },
```

- [ ] **Step 4: Insert the Arabic block**

Same position in `locales/ar.json`:

```json
  "tasks": {
    "title": "المهام",
    "upNext": "التالي",
    "earlier": "السابقة",
    "needsYou": "بانتظارك",
    "empty": "لا توجد مهام بعد",
    "emptyHint": "أضف ما تريد أن ينجزه كويل في غيابك.",
    "addTask": "إضافة مهمة",
    "addFromBlock": "إضافة كمهمة",
    "scheduleRun": "جدولة التنفيذ",
    "runNow": "تشغيل الآن",
    "cancel": "إلغاء",
    "cancelling": "سيتوقف بعد المهمة الحالية",
    "remove": "إزالة",
    "modeApply": "تطبيق",
    "modePropose": "اقتراح",
    "running": "جارٍ العمل…",
    "scheduled": "مجدولة",
    "done": "تم",
    "failed": "تعذّر التنفيذ",
    "skipped": "لم تُنفّذ",
    "waitingForYou": "بانتظار موافقتك",
    "ranLate": "نُفّذت متأخرة",
    "stoppedEarly": "توقّفت مبكرًا",
    "when": {
      "heading": "متى تريد التنفيذ؟",
      "inAnHour": "بعد ساعة",
      "tonight": "الليلة",
      "lateTonight": "آخر الليل",
      "tomorrowMorning": "صباح الغد"
    },
    "jobs": {
      "fix_captions": "إصلاح التسميات",
      "rebuild_toc": "إعادة بناء الفهرس",
      "build_figure_and_table_lists": "إنشاء قائمتي الأشكال والجداول",
      "apply_norms": "تطبيق معايير جامعتي",
      "fix_heading_levels": "تصحيح مستويات العناوين",
      "unify_typography": "توحيد الخطوط والتباعد",
      "proofread": "تدقيق لغوي",
      "remove_repetition": "إزالة التكرار",
      "write_abstract": "كتابة الملخص",
      "draft_section": "كتابة مسودة قسم",
      "custom_block_task": "شيء آخر"
    },
    "params": {
      "scope": "أي جزء؟",
      "scopePlaceholder": "مثلاً: الفصل الثاني",
      "normProfile": "أي معايير؟",
      "languages": "أي لغات؟",
      "request": "ماذا تريد من كويل؟"
    }
  },
```

- [ ] **Step 5: Prove nothing else moved**

```bash
cd ~/modakerati
for f in en fr ar; do
  node -e "JSON.parse(require('fs').readFileSync('locales/$f.json','utf8')); console.log('$f parses')"
done
git diff --stat locales/
```

Expected: all three print `parses`, and the diff shows **only insertions** — no deletions, no reindentation. Any deleted line means a round-trip happened; `git checkout locales/` and redo the insertion by hand.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(tasks): trilingual strings for the tasks screen

Inserted surgically. These files carry ~155 duplicate keys each and a
load/dump round-trip drops them silently."
```

---

## Task 5: The task row

Shared by the Up next list and the run report, so it exists once.

**Files:**
- Create: `components/tasks/TaskRow.tsx`

- [ ] **Step 1: Write it**

```tsx
// components/tasks/TaskRow.tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { Check, X, CircleDashed, Clock, Trash2 } from "lucide-react-native";
import type { TaskItem } from "@/lib/tasks-api";

/**
 * One task line. Shows what it is, where it applies and whether it will be
 * applied or proposed — and, once a run has happened, what became of it.
 *
 * `onRemove` is passed only while the run is still a draft; a scheduled or
 * finished run's tasks are history and must not sprout a delete button.
 */
export function TaskRow({ task, onRemove }: { task: TaskItem; onRemove?: (id: string) => void }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();

  const label = t(`tasks.jobs.${task.kind}`, { defaultValue: task.kind });
  const scope = task.target.scope ?? task.params.scope ?? task.target.anchor?.snippet;

  const statusColor =
    task.status === "done" ? colors.success
    : task.status === "failed" ? colors.danger
    : colors.textSecondary;

  const StatusIcon =
    task.status === "done" ? Check
    : task.status === "failed" ? X
    : task.status === "skipped" ? CircleDashed
    : Clock;

  return (
    <View style={[styles.row, { flexDirection, backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
      <StatusIcon size={16} color={statusColor} strokeWidth={2} />

      <View style={styles.body}>
        <Text numberOfLines={1} style={[styles.label, { color: colors.textPrimary, textAlign }]}>
          {label}
        </Text>
        {scope ? (
          <Text numberOfLines={1} style={[styles.scope, { color: colors.textSecondary, textAlign }]}>
            {scope}
          </Text>
        ) : null}
        {/* The reason a task could not be done is the whole point of the report —
            never truncate it to one line. */}
        {task.status === "failed" && task.result?.reason ? (
          <Text style={[styles.reason, { color: colors.danger, textAlign }]}>{task.result.reason}</Text>
        ) : null}
      </View>

      <View style={[styles.badge, { borderColor: task.mode === "apply" ? colors.success : colors.warning }]}>
        <Text style={[styles.badgeText, { color: task.mode === "apply" ? colors.success : colors.warning }]}>
          {t(task.mode === "apply" ? "tasks.modeApply" : "tasks.modePropose")}
        </Text>
      </View>

      {onRemove ? (
        <Pressable
          onPress={() => onRemove(task.id)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t("tasks.remove")}
        >
          <Trash2 size={16} color={colors.textTertiary} strokeWidth={2} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 14, fontWeight: "600" },
  scope: { fontSize: 12, marginTop: 2 },
  reason: { fontSize: 12, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: "600" },
});
```

- [ ] **Step 2: Check the colour names exist**

```bash
cd ~/modakerati && grep -nE "success|danger|warning|textTertiary|bgCard|borderDefault" constants/colors.ts | head
```

Every name used above must appear. If one does not, use the nearest real token — **never hardcode a hex value**; colours come from `useThemeColors()`.

- [ ] **Step 3: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add components/tasks/TaskRow.tsx
git commit -m "feat(tasks): one task row, shared by the queue and the report

A failed task's reason is never truncated — it is the whole point of the
report."
```

---

## Task 6: The job picker sheet

**Files:**
- Create: `components/tasks/JobPickerSheet.tsx`

- [ ] **Step 1: Write it**

```tsx
// components/tasks/JobPickerSheet.tsx
import { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { JobDef, TaskMode } from "@/lib/tasks-api";

/**
 * Pick a job, fill in its params, choose apply-or-propose.
 *
 * ⚠️ gorhom BottomSheet: this component is UNMOUNTED when closed (the parent
 * renders it conditionally) — keeping a closed sheet mounted orphans its portal
 * node. See the gorhom notes in the project memory.
 */
export function JobPickerSheet({
  jobs,
  onPick,
  onClose,
}: {
  jobs: JobDef[];
  onPick: (input: { kind: string; params: Record<string, string>; mode: TaskMode }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign } = useRTL();
  const sheetRef = useRef<BottomSheet>(null);

  const [selected, setSelected] = useState<JobDef | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<TaskMode>("apply");

  const snapPoints = useMemo(() => ["60%", "90%"], []);

  const choose = useCallback((job: JobDef) => {
    setSelected(job);
    setParams({});
    setMode(job.defaultMode);
  }, []);

  // Every param the job declares must be filled before it can be added — an
  // unattended run has nobody to ask "which chapter?".
  const ready = selected != null && selected.params.every((p) => (params[p] ?? "").trim().length > 0);

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={{ backgroundColor: colors.bgCard }}
      handleIndicatorStyle={{ backgroundColor: colors.borderDefault }}
    >
      <BottomSheetView style={styles.sheet}>
        {selected === null ? (
          <ScrollView>
            <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{t("tasks.addTask")}</Text>
            {jobs.map((job) => (
              <Pressable
                key={job.id}
                onPress={() => choose(job)}
                style={[styles.jobRow, { borderColor: colors.borderDefault }]}
              >
                <Text style={[styles.jobLabel, { color: colors.textPrimary, textAlign }]}>
                  {t(`tasks.jobs.${job.id}`, { defaultValue: job.id })}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <ScrollView>
            <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>
              {t(`tasks.jobs.${selected.id}`, { defaultValue: selected.id })}
            </Text>

            {selected.params.map((p) => (
              <View key={p} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
                  {t(`tasks.params.${p}`, { defaultValue: p })}
                </Text>
                <TextInput
                  value={params[p] ?? ""}
                  onChangeText={(v) => setParams((prev) => ({ ...prev, [p]: v }))}
                  placeholder={t("tasks.params.scopePlaceholder")}
                  placeholderTextColor={colors.textTertiary}
                  style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault, textAlign }]}
                />
              </View>
            ))}

            <View style={styles.modeRow}>
              {(["apply", "propose"] as TaskMode[]).map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMode(m)}
                  style={[
                    styles.modeChip,
                    { borderColor: mode === m ? colors.brandPrimary : colors.borderDefault },
                  ]}
                >
                  <Text style={{ color: mode === m ? colors.brandPrimary : colors.textSecondary, fontSize: 12 }}>
                    {t(m === "apply" ? "tasks.modeApply" : "tasks.modePropose")}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              disabled={!ready}
              onPress={() => onPick({ kind: selected.id, params, mode })}
              style={[styles.cta, { backgroundColor: ready ? colors.brandPrimary : colors.bgTertiary }]}
            >
              <Text style={{ color: ready ? colors.brandOnPrimary : colors.textTertiary, fontWeight: "600" }}>
                {t("tasks.addTask")}
              </Text>
            </Pressable>
          </ScrollView>
        )}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 16, paddingBottom: 24 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  jobRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  jobLabel: { fontSize: 14 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 18 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  cta: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add components/tasks/JobPickerSheet.tsx
git commit -m "feat(tasks): the job picker

Every param a job declares must be filled before the task can be added — an
unattended run has nobody to ask 'which chapter?'."
```

---

## Task 7: The schedule sheet

**Files:**
- Create: `components/tasks/ScheduleSheet.tsx`

- [ ] **Step 1: Write it**

```tsx
// components/tasks/ScheduleSheet.tsx
import { useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { SCHEDULE_PRESETS, resolvePreset, presetClock } from "@/lib/task-schedule";

/**
 * When should this run? Preset chips, plus Run now.
 *
 * No date picker on purpose — see lib/task-schedule.ts for why (it would be a
 * native module, which changes the fingerprint and cuts installed binaries off
 * from OTA updates).
 *
 * ⚠️ Unmounted by the parent when closed; see the gorhom note in JobPickerSheet.
 */
export function ScheduleSheet({
  onSchedule,
  onRunNow,
  onClose,
}: {
  onSchedule: (whenIso: string) => void;
  onRunNow: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign } = useRTL();
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["45%"], []);

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={{ backgroundColor: colors.bgCard }}
      handleIndicatorStyle={{ backgroundColor: colors.borderDefault }}
    >
      <BottomSheetView style={styles.sheet}>
        <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{t("tasks.when.heading")}</Text>

        {SCHEDULE_PRESETS.map((preset) => (
          <Pressable
            key={preset.id}
            onPress={() => onSchedule(resolvePreset(preset).toISOString())}
            style={[styles.row, { borderColor: colors.borderDefault }]}
          >
            <Text style={[styles.rowLabel, { color: colors.textPrimary, textAlign }]}>{t(preset.labelKey)}</Text>
            <Text style={[styles.rowClock, { color: colors.textSecondary }]}>{presetClock(preset)}</Text>
          </Pressable>
        ))}

        <Pressable onPress={onRunNow} style={[styles.cta, { backgroundColor: colors.brandPrimary }]}>
          <Text style={{ color: colors.brandOnPrimary, fontWeight: "600" }}>{t("tasks.runNow")}</Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 16, paddingBottom: 24 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14, flex: 1 },
  rowClock: { fontSize: 13, fontVariant: ["tabular-nums"] },
  cta: { marginTop: 18, paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add components/tasks/ScheduleSheet.tsx
git commit -m "feat(tasks): the schedule sheet — presets, and Run now"
```

---

## Task 8: The skeleton

**Files:**
- Create: `components/skeletons/TasksSkeleton.tsx`

- [ ] **Step 1: Match the house pattern**

```bash
cd ~/modakerati && sed -n '1,40p' components/skeletons/NotificationsSkeleton.tsx
```

Copy how it builds a pulse and shapes its blocks; the rule in this codebase is **layout-shaped, never a spinner, and one pulse per screen**.

- [ ] **Step 2: Write it**

```tsx
// components/skeletons/TasksSkeleton.tsx
import { useEffect, useRef } from "react";
import { View, Animated, Easing, StyleSheet } from "react-native";
import { useThemeColors } from "@/hooks/useThemeColors";

/**
 * The Tasks screen while it loads: the "Up next" header, three task rows and a
 * schedule button, in the shape they will really occupy.
 *
 * Layout-shaped, not a spinner — and ONE pulse for the screen, driven by the
 * parent, so rows don't shimmer out of phase with each other.
 */
export function TasksSkeleton() {
  const colors = useThemeColors();

  // The skeleton owns its own single pulse. The parent must NOT drive one:
  // this is the only pulse on the screen, and putting it here keeps every bar
  // in phase by construction.
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const bar = (w: number | string, h = 12, mb = 8) => (
    <Animated.View style={{ width: w as any, height: h, borderRadius: 6, marginBottom: mb, backgroundColor: colors.bgTertiary, opacity: pulse }} />
  );

  return (
    <View style={styles.wrap}>
      {bar("28%", 10, 14)}
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.row, { borderColor: colors.borderDefault }]}>
          <Animated.View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.bgTertiary, opacity: pulse }} />
          <View style={{ flex: 1 }}>
            {bar("62%", 12, 6)}
            {bar("38%", 10, 0)}
          </View>
        </View>
      ))}
      <Animated.View style={{ height: 46, borderRadius: 12, marginTop: 10, backgroundColor: colors.bgTertiary, opacity: pulse }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
});
```

- [ ] **Step 3: Typecheck and commit**

```bash
cd ~/modakerati && npx tsc --noEmit
git add components/skeletons/TasksSkeleton.tsx
git commit -m "feat(tasks): a layout-shaped loading state for the tasks screen"
```

---

## Task 9: The Tasks screen

**Files:**
- Create: `app/(app)/tasks.tsx`

- [ ] **Step 1: Write it**

```tsx
// app/(app)/tasks.tsx
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import { TasksSkeleton } from "@/components/skeletons/TasksSkeleton";
import { TaskRow } from "@/components/tasks/TaskRow";
import { JobPickerSheet } from "@/components/tasks/JobPickerSheet";
import { ScheduleSheet } from "@/components/tasks/ScheduleSheet";
import { useTasksStore, needsYou } from "@/stores/tasks-store";
import { AlertTriangle, Plus, Clock } from "lucide-react-native";

export default function TasksScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const { textAlign } = useRTL();
  const bottomPad = useSafeAreaInsets().bottom + 24;
  const { thesisId } = useLocalSearchParams<{ thesisId: string }>();

  // Select PRIMITIVES — a fresh object literal here throws "Maximum update depth".
  const jobs = useTasksStore((s) => s.jobs);
  const tasks = useTasksStore((s) => s.tasks);
  const runs = useTasksStore((s) => s.runs);
  const loading = useTasksStore((s) => s.loading);
  const busy = useTasksStore((s) => s.busy);
  const load = useTasksStore((s) => s.load);
  const add = useTasksStore((s) => s.add);
  const remove = useTasksStore((s) => s.remove);
  const schedule = useTasksStore((s) => s.schedule);
  const start = useTasksStore((s) => s.start);

  const [picking, setPicking] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (thesisId) void load(thesisId);
  }, [thesisId, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (thesisId) await load(thesisId);
    setRefreshing(false);
  }, [thesisId, load]);

  const attention = needsYou(runs);
  const finished = runs.filter((r) => r.status !== "draft");

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary, textAlign }]}>{t("tasks.title")}</Text>
      </View>

      {loading ? (
        <TasksSkeleton />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
        >
          {/* Only present when something is actually waiting. It collapses away
              rather than sitting there empty. */}
          {attention.length > 0 ? (
            <>
              <Text style={[styles.section, { color: colors.warning, textAlign }]}>{t("tasks.needsYou")}</Text>
              {attention.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push({ pathname: "/(app)/task-run", params: { runId: r.id } } as any)}
                  style={[styles.runCard, { backgroundColor: colors.bgCard, borderColor: colors.warning }]}
                >
                  <AlertTriangle size={16} color={colors.warning} strokeWidth={2} />
                  <Text style={[styles.runText, { color: colors.textPrimary, textAlign }]}>
                    {(r.summary?.proposed ?? 0) > 0
                      ? `${r.summary?.proposed} ${t("tasks.waitingForYou")}`
                      : `${r.summary?.failed} ${t("tasks.failed")}`}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Text style={[styles.section, { color: colors.textTertiary, textAlign }]}>{t("tasks.upNext")}</Text>

          {tasks.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: colors.textPrimary, textAlign }]}>{t("tasks.empty")}</Text>
              <Text style={[styles.emptyHint, { color: colors.textSecondary, textAlign }]}>{t("tasks.emptyHint")}</Text>
            </View>
          ) : (
            tasks.map((task) => <TaskRow key={task.id} task={task} onRemove={remove} />)
          )}

          <Pressable onPress={() => setPicking(true)} style={styles.addBtn}>
            <Plus size={16} color={colors.brandPrimary} strokeWidth={2.2} />
            <Text style={{ color: colors.brandPrimary, fontSize: 13, fontWeight: "600" }}>{t("tasks.addTask")}</Text>
          </Pressable>

          {tasks.length > 0 ? (
            <Pressable
              disabled={busy}
              onPress={() => setScheduling(true)}
              style={[styles.cta, { backgroundColor: busy ? colors.bgTertiary : colors.brandPrimary }]}
            >
              <Clock size={16} color={busy ? colors.textTertiary : colors.brandOnPrimary} strokeWidth={2} />
              <Text style={{ color: busy ? colors.textTertiary : colors.brandOnPrimary, fontWeight: "600" }}>
                {t("tasks.scheduleRun")}
              </Text>
            </Pressable>
          ) : null}

          {finished.length > 0 ? (
            <>
              <Text style={[styles.section, { color: colors.textTertiary, textAlign }]}>{t("tasks.earlier")}</Text>
              {finished.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push({ pathname: "/(app)/task-run", params: { runId: r.id } } as any)}
                  style={[styles.runCard, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
                >
                  <Text style={[styles.runText, { color: colors.textPrimary, textAlign }]}>
                    {r.status === "running" || r.status === "cancelling"
                      ? t("tasks.running")
                      : r.status === "scheduled"
                        ? t("tasks.scheduled")
                        : `${r.summary?.applied ?? 0} ${t("tasks.done")}`}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      {/* Sheets are UNMOUNTED when closed — a mounted-but-closed gorhom sheet
          orphans its portal node. */}
      {picking ? (
        <JobPickerSheet
          jobs={jobs}
          onClose={() => setPicking(false)}
          onPick={async (input) => {
            setPicking(false);
            await add(input);
          }}
        />
      ) : null}

      {scheduling ? (
        <ScheduleSheet
          onClose={() => setScheduling(false)}
          onSchedule={async (iso) => {
            setScheduling(false);
            await schedule(iso);
          }}
          onRunNow={async () => {
            setScheduling(false);
            await start();
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", flex: 1 },
  section: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", marginTop: 18, marginBottom: 8 },
  runCard: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
  runText: { fontSize: 13, flex: 1 },
  empty: { paddingVertical: 24, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "600" },
  emptyHint: { fontSize: 13 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 6 },
});
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. If `colors.bgPrimary` or similar does not exist, use the real token from `constants/colors.ts` — never a hex literal.

- [ ] **Step 3: See it on a device**

```bash
cd ~/modakerati-server && npm run dev &
cd ~/modakerati && npm start
```

Open the app, then navigate to `/(app)/tasks?thesisId=<a real thesis id>`. Confirm, in order:

1. The skeleton appears, then the empty state.
2. **Add a task** opens the picker; picking *Proofread* asks for a scope and defaults to **propose**; picking *Fix captions* asks nothing and defaults to **apply**.
3. The task appears in Up next, and the trash icon removes it.
4. **Schedule this run** offers four presets with sensible clock times.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add "app/(app)/tasks.tsx"
git commit -m "feat(tasks): the Tasks screen

One list that fills up, and a Needs-you band that exists only when something
is actually waiting."
```

---

## Task 10: The run report

**Files:**
- Create: `app/(app)/task-run.tsx`

- [ ] **Step 1: Write it**

```tsx
// app/(app)/task-run.tsx
import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { BackButton } from "@/components/BackButton";
import { TaskRow } from "@/components/tasks/TaskRow";
import { getRun, type TaskRun, type TaskItem, type TaskProposal } from "@/lib/tasks-api";
import { useTasksStore } from "@/stores/tasks-store";

/**
 * What one run did. Owns the things the document itself cannot show: what was
 * applied, what is waiting, what failed and WHY, and cancelling a run that is
 * still going.
 *
 * Reviewing the proposals happens in the Writer, not here — that is phase 3.
 * This screen only counts them.
 */
export default function TaskRunScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign } = useRTL();
  const bottomPad = useSafeAreaInsets().bottom + 24;
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const cancel = useTasksStore((s) => s.cancel);

  const [run, setRun] = useState<TaskRun | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [proposals, setProposals] = useState<TaskProposal[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRun = useCallback(async () => {
    if (!runId) return;
    try {
      const r = await getRun(runId);
      setRun(r.run);
      setTasks(r.tasks);
      setProposals(r.proposals);
    } catch {
      // Keep whatever is on screen; the pull-to-refresh is the retry.
    }
  }, [runId]);

  useEffect(() => {
    void fetchRun();
  }, [fetchRun]);

  // A run in flight changes underneath this screen, so poll while it does.
  // Stops the moment it settles — no timer left running on a finished run.
  useEffect(() => {
    if (run?.status !== "running" && run?.status !== "cancelling") return;
    const id = setInterval(() => void fetchRun(), 5000);
    return () => clearInterval(id);
  }, [run?.status, fetchRun]);

  const live = run?.status === "running" || run?.status === "cancelling";
  const pending = proposals.filter((p) => p.status === "pending").length;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary, textAlign }]}>{t("tasks.title")}</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await fetchRun(); setRefreshing(false); }}
            tintColor={colors.textSecondary}
          />
        }
      >
        {run ? (
          <View style={[styles.summary, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}>
            <Text style={[styles.summaryText, { color: colors.textPrimary, textAlign }]}>
              {live
                ? t("tasks.running")
                : [
                    (run.summary?.applied ?? 0) > 0 ? `${run.summary?.applied} ${t("tasks.done")}` : null,
                    pending > 0 ? `${pending} ${t("tasks.waitingForYou")}` : null,
                    (run.summary?.failed ?? 0) > 0 ? `${run.summary?.failed} ${t("tasks.failed")}` : null,
                  ].filter(Boolean).join(" · ")}
            </Text>
            {/* Honest about the two ways a run can end short of its list. */}
            {run.summary?.stoppedForBudget ? (
              <Text style={[styles.note, { color: colors.warning, textAlign }]}>{t("tasks.stoppedEarly")}</Text>
            ) : null}
            {run.summary?.lateMinutes ? (
              <Text style={[styles.note, { color: colors.textSecondary, textAlign }]}>{t("tasks.ranLate")}</Text>
            ) : null}
            {run.status === "cancelling" ? (
              <Text style={[styles.note, { color: colors.textSecondary, textAlign }]}>{t("tasks.cancelling")}</Text>
            ) : null}
          </View>
        ) : null}

        {tasks.map((task) => <TaskRow key={task.id} task={task} />)}

        {run?.status === "scheduled" || run?.status === "running" ? (
          <Pressable
            onPress={() => void cancel(run.id).then(fetchRun)}
            style={[styles.cancel, { borderColor: colors.danger }]}
          >
            <Text style={{ color: colors.danger, fontWeight: "600" }}>{t("tasks.cancel")}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: "700", flex: 1 },
  summary: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 14 },
  summaryText: { fontSize: 14, fontWeight: "600" },
  note: { fontSize: 12, marginTop: 6 },
  cancel: { marginTop: 18, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: "center" },
});
```

- [ ] **Step 2: Typecheck and verify on device**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Then, with the server running, schedule a run from the Tasks screen using **Run now**, and open it from the Earlier list. Confirm:

1. It shows **Working…** and refreshes itself every 5s without you pulling.
2. **Cancel run** appears while it is live, and after tapping it the screen reads "Stopping after the current task".
3. When it finishes, the summary line matches what the server recorded, and any failed task shows its reason in full.

- [ ] **Step 3: Commit**

```bash
cd ~/modakerati
git add "app/(app)/task-run.tsx"
git commit -m "feat(tasks): the run report

Owns what the document cannot show — what was applied, what is waiting, what
failed and why. Polls only while the run is live, and stops the moment it
settles."
```

---

## Task 11: The drawer row

**Files:**
- Modify: `components/AppDrawer.tsx:279`

- [ ] **Step 1: Add the row**

In `components/AppDrawer.tsx`, in the same array that holds the `library` and `news` entries, insert **before** `library`:

```tsx
    {
      key: "tasks",
      icon: ListChecks,
      label: t("tasks.title"),
      onPress: () =>
        go(() =>
          router.push({ pathname: "/(app)/tasks", params: { thesisId: currentThesis?.id } } as any),
        ),
    },
```

and add `ListChecks` to the existing `lucide-react-native` import at the top of the file.

- [ ] **Step 2: Handle the no-thesis case**

Tasks act on a thesis, so the row must not open an empty screen. `currentThesis` is already in scope (`components/AppDrawer.tsx:197`), and the export entry at line 216 already shows the house pattern — an `if (currentThesis)` guard inside `onPress`. Match it exactly:

```tsx
      onPress: () =>
        go(() => {
          if (currentThesis) {
            router.push({
              pathname: "/(app)/tasks",
              params: { thesisId: currentThesis.id },
            } as any);
          }
        }),
```

Replace the `onPress` from Step 1 with this version.

- [ ] **Step 3: Typecheck and verify**

```bash
cd ~/modakerati && npx tsc --noEmit
```

Open the drawer on a device: the Tasks row sits above Library, and tapping it opens the Tasks screen for the thesis you have open. With no thesis open, it does nothing rather than opening a blank screen.

- [ ] **Step 4: Commit**

```bash
cd ~/modakerati
git add components/AppDrawer.tsx
git commit -m "feat(tasks): Tasks in the nav drawer"
```

---

## Task 12: "Add as task" from a block

The one-tap path. The block bubble already knows what is selected, so this captures it as an anchor and drops it into Up next without navigating.

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx:406-440`
- Create: `components/tasks/AddBlockTaskSheet.tsx`

- [ ] **Step 1: Write the sheet**

```tsx
// components/tasks/AddBlockTaskSheet.tsx
import { useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import BottomSheet, { BottomSheetView } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import type { TaskMode } from "@/lib/tasks-api";

/**
 * "Add as task" for the block the student is looking at.
 *
 * Free text is safe here precisely BECAUSE the scope is pinned: the anchor is
 * the paragraph they selected, so the unattended run never has to guess which
 * one they meant. The snippet travels with it so the server can re-find the
 * block if the document moves before the run (lib/tasks/anchor.ts server-side).
 */
export function AddBlockTaskSheet({
  snippet,
  onAdd,
  onClose,
}: {
  snippet: string;
  onAdd: (input: { request: string; mode: TaskMode }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign } = useRTL();
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["45%"], []);
  const [request, setRequest] = useState("");
  const [mode, setMode] = useState<TaskMode>("propose");

  return (
    <BottomSheet
      ref={sheetRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      onClose={onClose}
      backgroundStyle={{ backgroundColor: colors.bgCard }}
      handleIndicatorStyle={{ backgroundColor: colors.borderDefault }}
    >
      <BottomSheetView style={styles.sheet}>
        <Text style={[styles.heading, { color: colors.textPrimary, textAlign }]}>{t("tasks.addFromBlock")}</Text>

        <Text numberOfLines={2} style={[styles.snippet, { color: colors.textSecondary, textAlign }]}>
          {snippet}
        </Text>

        <TextInput
          value={request}
          onChangeText={setRequest}
          placeholder={t("tasks.params.request")}
          placeholderTextColor={colors.textTertiary}
          multiline
          style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault, textAlign }]}
        />

        <View style={styles.modeRow}>
          {(["apply", "propose"] as TaskMode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => setMode(m)}
              style={[styles.modeChip, { borderColor: mode === m ? colors.brandPrimary : colors.borderDefault }]}
            >
              <Text style={{ color: mode === m ? colors.brandPrimary : colors.textSecondary, fontSize: 12 }}>
                {t(m === "apply" ? "tasks.modeApply" : "tasks.modePropose")}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          disabled={request.trim().length === 0}
          onPress={() => onAdd({ request: request.trim(), mode })}
          style={[styles.cta, { backgroundColor: request.trim() ? colors.brandPrimary : colors.bgTertiary }]}
        >
          <Text style={{ color: request.trim() ? colors.brandOnPrimary : colors.textTertiary, fontWeight: "600" }}>
            {t("tasks.addTask")}
          </Text>
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingHorizontal: 16, paddingBottom: 24 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  snippet: { fontSize: 12, marginBottom: 14, fontStyle: "italic" },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 72, textAlignVertical: "top" },
  modeRow: { flexDirection: "row", gap: 8, marginVertical: 14 },
  modeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  cta: { paddingVertical: 14, borderRadius: 12, alignItems: "center" },
});
```

- [ ] **Step 2: Add the chip to the block bubble**

In `components/workspace/BlockContextBar.tsx`, directly after the `OutlineBtn` definition (around line 440), add a second pinned chip built the same way:

```tsx
  // "Add as task" — the one-tap path from a paragraph the student is looking at
  // into Up next. Pinned beside the outline button so it is never scrolled off
  // with the formatting tools. Hidden for a header/footer band and for a
  // picture, for the same reasons the ✦ is: neither has a paragraph to act on.
  const canTask = !isHfBand && kind !== "image" && selectedBlock?.kind === "paragraph";
  const TaskBtn = canTask ? (
    <Pressable
      onPress={() => setAddingTask(true)}
      accessibilityRole="button"
      accessibilityLabel={t("tasks.addFromBlock")}
      style={[styles.pinnedChip, { backgroundColor: colors.bgCard, borderColor: colors.borderDefault }]}
    >
      <ListChecks size={18} color={colors.textPrimary} strokeWidth={2} />
    </Pressable>
  ) : null;
```

Add `ListChecks` to this file's `lucide-react-native` import, add `const [addingTask, setAddingTask] = useState(false);` beside the file's other `useState` calls, and render `{TaskBtn}` immediately after `{OutlineBtn}` wherever that is placed.

- [ ] **Step 3: Wire the sheet**

At the end of the same component's returned tree, beside the existing `{cropModal}`:

```tsx
      {addingTask && selectedBlock ? (
        <AddBlockTaskSheet
          snippet={selectedBlock.text ?? ""}
          onClose={() => setAddingTask(false)}
          onAdd={async ({ request, mode }) => {
            setAddingTask(false);
            const store = useTasksStore.getState();
            // The screen may never have been opened, so there is no draft run
            // loaded yet — load it first, then add.
            if (store.thesisId !== thesisId) await store.load(thesisId);
            await useTasksStore.getState().add({
              kind: "custom_block_task",
              params: { request, snippet: selectedBlock.text ?? "" },
              // Index AND snippet: the index is a hint, the text is the
              // identity, because the document may move before the run.
              target: { anchor: { index: selectedBlock.index, snippet: selectedBlock.text ?? "" } },
              mode,
            });
          }}
        />
      ) : null}
```

and import both at the top of the file:

```tsx
import { AddBlockTaskSheet } from "@/components/tasks/AddBlockTaskSheet";
import { useTasksStore } from "@/stores/tasks-store";
```

- [ ] **Step 4: Typecheck**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. `selectedBlock` is `DocBlockDTO | null | undefined` (`BlockContextBar.tsx:99`), and `DocBlockDTO` is a discriminated union — its `paragraph` variant carries `index: number` and `text: string` (`lib/api.ts:1200-1202`). The `selectedBlock?.kind === "paragraph"` guard in `canTask` is what narrows the union, so `.text` is only reachable where it exists. Do not widen that guard.

- [ ] **Step 5: Verify the whole path on a device**

With the server running, in the Writer:

1. Tap a paragraph → the bubble shows the new checklist chip beside the outline button.
2. Tap it, type "اجعلها أوضح", leave the mode on **propose**, tap Add.
3. Open the drawer → Tasks. The task is in **Up next**, showing the paragraph's text as its scope.
4. **Run now**, and confirm on the report that it completed and the paragraph in the document was **not** changed.

That last check is the point of the whole feature: a propose task must leave the document alone.

- [ ] **Step 6: Commit**

```bash
cd ~/modakerati
git add components/tasks/AddBlockTaskSheet.tsx components/workspace/BlockContextBar.tsx
git commit -m "feat(tasks): Add as task, from the block you're looking at

Free text is safe here because the scope is pinned to the selected paragraph.
The anchor carries index AND snippet — the index is a hint, the text is the
identity, because the document may move before the run fires."
```

---

## Task 13: "Kwill is working" in the Writer

The spec asks for the writer to go **read-only behind a banner** while a run executes. This task builds the banner and the refetch. **Full read-only enforcement is deliberately deferred** — see the note at the end of this task; do not silently skip it, and do not attempt it without reading that note.

**Files:**
- Create: `components/tasks/RunningBanner.tsx`
- Modify: `stores/tasks-store.ts`
- Modify: `app/(app)/thesis-workspace.tsx`

- [ ] **Step 1: Track the live run in the store**

Add to `TasksState` in `stores/tasks-store.ts`, beside the existing fields:

```ts
  /** The run currently executing on this thesis, if any. Drives the Writer banner. */
  liveRunId: string | null;
  /** Poll for a live run. Cheap: one request, and only while one is live. */
  watchLive: (thesisId: string) => Promise<boolean>;
```

and in the store body, beside the other actions:

```ts
  liveRunId: null,

  watchLive: async (thesisId) => {
    try {
      const runs = await listRuns(thesisId);
      const live = runs.find((r) => r.status === "running" || r.status === "cancelling");
      const was = get().liveRunId;
      set({ liveRunId: live?.id ?? null });
      // Returns true exactly on the falling edge — the run just finished, so
      // the caller knows to refetch the document ONCE rather than on a timer.
      return was !== null && live == null;
    } catch {
      return false;
    }
  },
```

Set `liveRunId: null` in the initial state object too.

- [ ] **Step 2: Write the banner**

```tsx
// components/tasks/RunningBanner.tsx
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { Loader } from "lucide-react-native";

/**
 * Shown across the top of the Writer while a scheduled run is working on this
 * thesis. The student's own edits and the run's edits are both landing on the
 * same .docx, so at minimum they must know it is happening.
 */
export function RunningBanner() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { textAlign, flexDirection } = useRTL();

  return (
    <View style={[styles.bar, { flexDirection, backgroundColor: colors.bgTertiary }]}>
      <Loader size={14} color={colors.textSecondary} strokeWidth={2} />
      <Text style={[styles.text, { color: colors.textSecondary, textAlign }]}>{t("tasks.running")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  text: { fontSize: 12, flex: 1 },
});
```

- [ ] **Step 3: Wire it into the Writer**

In `app/(app)/thesis-workspace.tsx`, add the imports:

```tsx
import { RunningBanner } from "@/components/tasks/RunningBanner";
import { useTasksStore } from "@/stores/tasks-store";
```

Add, beside the screen's other hooks:

```tsx
  const liveRunId = useTasksStore((s) => s.liveRunId);

  // Check once on mount, then poll ONLY while a run is live — and refetch the
  // document the moment one finishes, so the student sees the result without
  // pulling to refresh.
  useEffect(() => {
    if (!thesisId) return;
    let cancelled = false;
    const tick = async () => {
      const justFinished = await useTasksStore.getState().watchLive(thesisId);
      if (justFinished && !cancelled) void useThesisDocStore.getState().revalidate(thesisId);
    };
    void tick();
    const id = setInterval(tick, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [thesisId]);
```

and render the banner directly above the editor surface:

```tsx
  {liveRunId ? <RunningBanner /> : null}
```

- [ ] **Step 4: Typecheck and verify**

```bash
cd ~/modakerati && npx tsc --noEmit
```

On a device: queue a task, tap **Run now**, then go straight to the Writer. The banner appears within 20 seconds and disappears when the run ends, and the document refreshes itself to show what changed — without a pull-to-refresh.

- [ ] **Step 5: Commit**

```bash
cd ~/modakerati
git add components/tasks/RunningBanner.tsx stores/tasks-store.ts "app/(app)/thesis-workspace.tsx"
git commit -m "feat(tasks): tell the student when a run is working on their thesis

Polls only while a run is live, and refetches the document once on the
falling edge rather than on a timer."
```

### ⚠️ Why read-only is not in this task

The spec's justification was that the run holds `withThesisLock` for its whole duration, so an interleaved edit is impossible anyway and the app should reflect that. **Phase 1 changed this**: the executor cannot hold the lock across a run (every document tool takes it per call, and it is not reentrant), so the run now behaves exactly like an ordinary AI chat turn — which this app has never made the writer read-only for.

Making the Writer read-only is therefore a new UX intervention, not a reflection of a lock, and it touches editability plumbing across `thesis-workspace.tsx` and `WorkspaceLexicalView` that this plan has not mapped. Doing it badly — leaving the student unable to type with no way out — is worse than the interleaving risk it guards against.

**Decide this deliberately before phase 3.** The options are: leave it as the banner (edits interleave exactly as they do during a chat turn), make it read-only properly, or have the run yield when the app comes to the foreground.

---

## Task 14: Final pass

- [ ] **Step 1: Typecheck the whole app**

Run: `cd ~/modakerati && npx tsc --noEmit`
Expected: no errors. This is the only automated gate this repo has.

- [ ] **Step 2: Run the `use dom` gate**

```bash
cd ~/modakerati && node scripts/verify-use-dom.mjs
```

Expected: passes. Nothing in this phase adds a `"use dom"` file, but a named export slipped into one breaks the whole screen at bundle time and tsc is blind to it — so the gate runs anyway.

- [ ] **Step 3: Confirm the locale files never round-tripped**

```bash
cd ~/modakerati && git diff master --stat locales/
```

Expected: insertions only, no deletions in any of the three files.

- [ ] **Step 4: Walk the feature once, end to end**

On a device, with the server running:

1. Drawer → Tasks on a thesis with no queue → empty state.
2. Add *Fix captions* (apply) and *Proofread — chapter 2* (propose).
3. Schedule for **In an hour**, confirm it moves to Earlier as **Scheduled**, then cancel it.
4. Add the two again, **Run now**, watch the report update by itself.
5. Confirm the finished run shows in **Needs you** if it produced proposals or failures.

- [ ] **Step 5: Commit anything outstanding**

```bash
cd ~/modakerati && git status --porcelain
```

Expected: clean.

---

## Done when

- `npx tsc --noEmit` passes
- `node scripts/verify-use-dom.mjs` passes
- The device walkthrough in Task 14 Step 4 completes without a blank screen or a crash
- A propose-mode task queued from a block runs and leaves the paragraph unchanged

## Not in this phase

Reviewing proposals in the document (the stepper pill, accept/reject, approve-all, undo-the-run) is **phase 3**. This phase only counts proposals; nothing here can apply or reject one.
