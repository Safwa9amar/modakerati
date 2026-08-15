import { create } from "zustand";
import i18n from "@/lib/i18n";
import { resolveBlockIndexStrict } from "@/lib/block-links";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useSuggestionStore, type PendingSuggestion } from "@/stores/suggestion-store";
import {
  listJobs, nextRun, addTask, removeTask, scheduleRun, runNow, cancelRun, listRuns,
  listPendingProposals, decideProposal,
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
  /**
   * Put every pending proposal for this thesis onto its paragraph, as an
   * ordinary inline suggestion. Returns how many are now showing.
   */
  hydrateProposals: (thesisId: string) => Promise<number>;
  /** Hydrate, then approve every pending proposal. Returns how many applied. */
  approveAllPending: (thesisId: string) => Promise<number>;
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

  hydrateProposals: async (thesisId) => {
    let pending: Awaited<ReturnType<typeof listPendingProposals>>;
    try {
      pending = await listPendingProposals(thesisId);
    } catch {
      return 0;
    }
    if (!pending.length) return 0;

    // DocumentDTO is a union — the unavailable arm carries no blocks at all.
    const doc = useThesisDocStore.getState().byId[thesisId];
    const blocks = doc && doc.available ? doc.blocks : undefined;

    // ⚠️ Without loaded blocks NOTHING resolves, and every proposal looks like it
    // has lost its paragraph. Voiding them here DESTROYED real work: the Writer
    // hydrated on mount, before the document had arrived, and marked an entire
    // run stale before the student ever saw it. No document, no verdict — leave
    // them pending and hydrate again once it lands.
    if (!blocks?.length) return 0;

    const cards: Record<number, PendingSuggestion> = {};
    let shown = 0;

    for (const p of pending) {
      // Re-resolved against the LIVE document: the run happened hours ago and
      // the student may have edited since.
      const at = resolveBlockIndexStrict(blocks, p.anchor.index, p.anchor.snippet || p.beforeText);
      if (at === null) {
        // Do not guess, and do not leave it pending for ever — void it so the
        // Needs-you band can empty rather than the student chasing a ghost.
        void decideProposal(p.id, "stale").catch(() => {});
        continue;
      }
      // byIndex is keyed by block, so two proposals on one paragraph cannot both
      // show. Keep the first; the second stays pending for the next pass.
      if (cards[at]) continue;

      cards[at] = {
        index: at,
        original: p.beforeText,
        proposed: p.afterText,
        instruction: p.note,
        status: "ready",
        action: "rewrite",
        // No live model call produced this — the thinking happened during the
        // run, hours ago, and is not what the student is judging now.
        reasoning: "",
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

  approveAllPending: async (thesisId) => {
    // Hydrate FIRST. Marking the rows accepted server-side would drop them out
    // of the pending list this reads from, and the document would never change
    // — the student would be told "approved" over untouched text.
    await get().hydrateProposals(thesisId);
    const cards = Object.values(useSuggestionStore.getState().byIndex).filter((c) => !!c.proposalId);
    // Descending: approve() dispatches an editText per block, and working from
    // the end means an edit cannot shift a block this loop has not reached yet.
    for (const card of cards.sort((a, b) => b.index - a.index)) {
      useSuggestionStore.getState().approve(thesisId, card.index);
    }
    return cards.length;
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
