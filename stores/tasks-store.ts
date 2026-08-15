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
  liveRunId: null,

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
