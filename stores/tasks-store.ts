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

// Stable empty arrays — a fresh `[]` returned from a selector is a new snapshot
// every render, which is the same crash.
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
  /** The last load could not reach the server. Surfaced, never swallowed. */
  failed: boolean;
  /** The run currently executing on this thesis, if any. Drives the Writer banner. */
  liveRunId: string | null;

  load: (thesisId: string) => Promise<void>;
  refresh: () => Promise<void>;
  add: (input: { kind: string; params?: Record<string, string>; target?: TaskTarget; mode?: TaskMode }) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
  schedule: (whenIso: string, title?: string) => Promise<void>;
  start: () => Promise<void>;
  cancel: (runId: string) => Promise<void>;
  /** Poll for a live run. Cheap: one request, and only while one is live. */
  watchLive: (thesisId: string) => Promise<boolean>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  thesisId: null,
  jobs: [],
  draft: null,
  tasks: EMPTY_TASKS,
  runs: EMPTY_RUNS,
  loading: false,
  busy: false,
  failed: false,
  liveRunId: null,

  load: async (thesisId) => {
    set({ loading: true, thesisId, failed: false });

    // allSettled, NOT all: these are three independent questions, and a single
    // Promise.all rejection used to blank all three — which is how tapping
    // "Add a task" produced a sheet with a heading and nothing under it, with
    // no explanation at all. Each answer now stands or falls on its own.
    const [jobsR, nextR, runsR] = await Promise.allSettled([
      listJobs(),
      nextRun(thesisId),
      listRuns(thesisId),
    ]);

    const failed = [jobsR, nextR, runsR].some((r) => r.status === "rejected");
    if (failed) {
      console.warn("[tasks] load partially failed", {
        jobs: jobsR.status,
        next: nextR.status,
        runs: runsR.status,
      });
    }

    set({
      // Keep the last good value rather than blanking on a transient failure —
      // the same convention as outline-store.sync.
      jobs: jobsR.status === "fulfilled" ? jobsR.value : get().jobs,
      draft: nextR.status === "fulfilled" ? nextR.value.run : null,
      tasks: nextR.status === "fulfilled" ? nextR.value.tasks : EMPTY_TASKS,
      runs:
        runsR.status === "fulfilled"
          ? runsR.value
              .filter((r) => r.status !== "draft")
              // Newest first; the draft is shown separately as "Up next".
              .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
          : get().runs,
      loading: false,
      failed,
    });
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

  watchLive: async (thesisId) => {
    try {
      const runs = await listRuns(thesisId);
      const live = runs.find((r) => r.status === "running" || r.status === "cancelling");
      const was = get().liveRunId;
      set({ liveRunId: live?.id ?? null });
      // True exactly on the falling edge — the run just finished, so the caller
      // knows to refetch the document ONCE rather than on a timer.
      return was !== null && live == null;
    } catch {
      return false;
    }
  },
}));

/** Runs holding something the student must deal with. Drives the "Needs you" band. */
export function needsYou(runs: TaskRun[]): TaskRun[] {
  return runs.filter(
    (r) => r.status === "done" && ((r.summary?.proposed ?? 0) > 0 || (r.summary?.failed ?? 0) > 0),
  );
}
