import { create } from "zustand";
import {
  listThreads,
  createThread,
  patchThread,
  deleteThread,
  searchThreads,
  type ChatThread,
  type ThreadSearchResult,
} from "@/lib/api";

// Owns the conversation list for the history panel: every thread the student
// can switch to, search results, and which one is currently open. The server
// stays the source of truth for ordering (pinned first, then most recent) —
// this store only holds what it was given; see lib/thread-groups.ts for the
// one place a fetched list gets partitioned for display.

// Stable empty results — a fresh `[]` from a selector would make
// useSyncExternalStore see a new snapshot every render and throw "Maximum
// update depth exceeded". Not needed for `threads`/`results` themselves (they
// are plain state fields, only ever replaced by `set`), but kept here as the
// one shared fallback so nothing downstream has to invent its own `[]`.
const EMPTY_RESULTS: ThreadSearchResult[] = [];

interface ChatThreadsState {
  threads: ChatThread[];
  currentThreadId: string | null;
  loading: boolean;
  query: string;
  results: ThreadSearchResult[];
  searching: boolean;

  /** Fetch the thread list, optionally scoped to one thesis. Best-effort: on
   *  failure the last good list stays on screen (same convention as
   *  outline-store.sync). */
  load: (thesisId?: string) => Promise<void>;
  setCurrent: (id: string | null) => void;
  /** Optimistically create a thread (shown first, matching the server's own
   *  ranking for a brand-new empty thread), reconciled with the real row.
   *  Returns the new thread's id. */
  newThread: (thesisId?: string | null) => Promise<string>;
  rename: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  setArchived: (id: string, archived: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  search: (q: string) => Promise<void>;
  /** Applies the [[MODK_TITLE]] stream frame: a thread just got its first
   *  generated title, live, without waiting for a refetch. */
  applyTitle: (threadId: string, title: string) => void;
}

export const useChatThreadsStore = create<ChatThreadsState>((set, get) => ({
  threads: [],
  currentThreadId: null,
  loading: false,
  query: "",
  results: EMPTY_RESULTS,
  searching: false,

  load: async (thesisId) => {
    set({ loading: true });
    try {
      const threads = await listThreads(thesisId ? { thesisId } : undefined);
      set({ threads });
    } catch {
      // Keep whatever is already on screen — a failed refresh must never blank
      // the panel out from under the student.
    } finally {
      set({ loading: false });
    }
  },

  setCurrent: (id) => set({ currentThreadId: id }),

  newThread: async (thesisId) => {
    const tempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const optimistic: ChatThread = {
      id: tempId,
      thesisId: thesisId ?? null,
      title: null,
      pinned: false,
      archivedAt: null,
      lastMessageAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // Shown first — the server ranks a brand-new empty thread first too, so this
    // matches what the reconciled list will look like once the real row lands.
    set((s) => ({ threads: [optimistic, ...s.threads] }));
    try {
      const thread = await createThread(thesisId);
      set((s) => ({ threads: s.threads.map((t) => (t.id === tempId ? thread : t)) }));
      return thread.id;
    } catch (e) {
      // Roll back rather than leave a fake row the student could tap into.
      set((s) => ({ threads: s.threads.filter((t) => t.id !== tempId) }));
      throw e;
    }
  },

  rename: async (id, title) => {
    const prev = get().threads;
    set({ threads: prev.map((t) => (t.id === id ? { ...t, title } : t)) });
    try {
      const updated = await patchThread(id, { title });
      set((s) => ({ threads: s.threads.map((t) => (t.id === id ? updated : t)) }));
    } catch {
      set({ threads: prev }); // roll back rather than leave the list lying
    }
  },

  setPinned: async (id, pinned) => {
    const prev = get().threads;
    set({ threads: prev.map((t) => (t.id === id ? { ...t, pinned } : t)) });
    try {
      const updated = await patchThread(id, { pinned });
      set((s) => ({ threads: s.threads.map((t) => (t.id === id ? updated : t)) }));
    } catch {
      set({ threads: prev });
    }
  },

  setArchived: async (id, archived) => {
    const prev = get().threads;
    set({
      threads: prev.map((t) =>
        t.id === id ? { ...t, archivedAt: archived ? new Date().toISOString() : null } : t
      ),
    });
    try {
      const updated = await patchThread(id, { archived });
      set((s) => ({ threads: s.threads.map((t) => (t.id === id ? updated : t)) }));
    } catch {
      set({ threads: prev });
    }
  },

  remove: async (id) => {
    const prev = get().threads;
    set({ threads: prev.filter((t) => t.id !== id) });
    try {
      await deleteThread(id);
    } catch {
      // The delete never landed server-side — put the row back rather than
      // leave the panel showing a thread that still exists.
      set({ threads: prev });
    }
  },

  search: async (q) => {
    set({ query: q });
    if (!q.trim()) {
      set({ results: EMPTY_RESULTS, searching: false });
      return;
    }
    set({ searching: true });
    try {
      const results = await searchThreads(q);
      // Stale-response guard: a slower earlier request must not clobber a
      // faster later one's results.
      if (get().query === q) set({ results });
    } catch {
      if (get().query === q) set({ results: EMPTY_RESULTS });
    } finally {
      if (get().query === q) set({ searching: false });
    }
  },

  applyTitle: (threadId, title) =>
    set((s) => ({ threads: s.threads.map((t) => (t.id === threadId ? { ...t, title } : t)) })),
}));
