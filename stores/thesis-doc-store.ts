import { create } from "zustand";
import { Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { getThesisDocument, getThesisHistory, type DocumentDTO } from "@/lib/api";
import { getDocCache, setDocCache } from "@/lib/thesis-doc-cache";
import { applyOpToDoc, executeOp, isRetryableError, type ThesisOp } from "@/lib/thesis-ops";
import {
  newOpId,
  enqueueOp,
  confirmOp,
  bumpOpAttempts,
  listQueuedOps,
  clearQueuedOps,
} from "@/lib/thesis-op-queue";
import i18n from "@/lib/i18n";

// Owns the live-.docx block model per thesis so editing feels instant AND survives
// failure:
//   • On open we hydrate from the on-device SQLite cache (paint immediately),
//     replay any queued-but-unsent ops on top, then revalidate from the server in
//     the background (stale-while-revalidate).
//   • Manual edits are serializable OPS (lib/thesis-ops.ts): applied to the local
//     blocks optimistically (no network wait), persisted to the durable queue
//     (lib/thesis-op-queue.ts) BEFORE the server call, then flushed strictly in
//     order by a per-thesis pump. The edit endpoints echo the mutated document,
//     so the last op's response reconciles the state (no extra GET).
//   • A NETWORK failure keeps the op queued — the pump retries with backoff and
//     wakes on reconnect; edits survive an app kill and replay on next open.
//   • A SERVER REJECTION (4xx — the doc changed under us) poisons the positional
//     indices of everything queued after it: the whole queue for that thesis is
//     dropped and the server's truth re-fetched.
//
// The server stays the source of truth; this store is a fast local mirror.

interface PumpItem {
  id: string;
  op: ThesisOp;
  attempts: number;
  resolve?: () => void;
  reject?: (e: unknown) => void;
}

interface Pump {
  queue: PumpItem[];
  running: boolean;
  // Resolves the pump's current backoff sleep early (reconnect / new op).
  wake?: () => void;
}

// Fired on every optimistic manual-edit op — lets live renderers (the Word
// WebView) patch their DOM in place immediately instead of waiting for the
// confirm-time silent refresh. Fires BEFORE the network flush.
type DocOpListener = (thesisId: string, op: ThesisOp) => void;
const opListeners = new Set<DocOpListener>();
export function onThesisDocOp(listener: DocOpListener): () => void {
  opListeners.add(listener);
  return () => {
    opListeners.delete(listener);
  };
}

// Module-level (non-reactive) pump state; the store mirrors only the counts.
const pumps = new Map<string, Pump>();
// One-shot restore of the disk queue per thesis per session (memoized promise).
// Pump starts are gated on it so a restore can never splice older disk ops into
// a queue whose head is already in flight (which would misorder the replay).
const restorePromises = new Map<string, Promise<void>>();

function pumpFor(thesisId: string): Pump {
  let p = pumps.get(thesisId);
  if (!p) {
    p = { queue: [], running: false };
    pumps.set(thesisId, p);
  }
  return p;
}

// Backoff sleep that a reconnect or a new mutate() can cut short.
function sleepWithWake(p: Pump, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      p.wake = undefined;
      resolve();
    }, ms);
    p.wake = () => {
      clearTimeout(t);
      p.wake = undefined;
      resolve();
    };
  });
}

interface ThesisDocState {
  // Last-known document per thesis. `undefined` = never loaded (show a spinner);
  // `available:false` = legacy/unseeded (fall back to the section render).
  byId: Record<string, DocumentDTO | undefined>;
  // Monotonic per-thesis token bumped ONLY when the server bytes change (a real
  // reconcile), not on optimistic patches — the Word/PDF WebViews key their reload
  // URL on it, so it must track actual .docx changes, not in-memory previews.
  tick: Record<string, number>;
  // Unconfirmed ops per thesis (queued + in-flight). Drives the "saving" hint and
  // gates revalidate so a stale fetch can't clobber unflushed optimistic edits.
  pending: Record<string, number>;
  // Bumped when a thesis's op queue fully drains (all edits confirmed) — the
  // workspace re-fetches the OnlyOffice editor-config on it so the Word/PDF
  // layers reload the new bytes (their document.key derives from updatedAt).
  drainTick: Record<string, number>;
  revalidating: Record<string, boolean>;
  // Server-reported undo/redo availability (from edit echoes + GET /history).
  history: Record<string, { canUndo: boolean; canRedo: boolean }>;

  hydrate: (thesisId: string) => Promise<void>;
  revalidate: (thesisId: string) => Promise<void>;
  load: (thesisId: string) => Promise<void>;
  setDoc: (thesisId: string, doc: DocumentDTO) => void;
  // Apply `op` optimistically, persist it durably, and flush in the background.
  // Resolves when the server confirms; rejects only on a permanent (non-network)
  // rejection — never on offline (the op stays queued). Safe to ignore the result.
  mutate: (thesisId: string, op: ThesisOp) => Promise<void>;
  setHistoryState: (thesisId: string, h: { canUndo: boolean; canRedo: boolean }) => void;
  refreshHistoryState: (thesisId: string) => Promise<void>;
  // Replace the doc after a server-side restore (undo/redo/history sheet): full
  // reconcile — bumps tick (Word view reloads) AND drainTick (editor config/PDF
  // re-key). Callers must only invoke while pending === 0.
  applyRestoredDoc: (thesisId: string, doc: DocumentDTO, h: { canUndo: boolean; canRedo: boolean }) => void;
}

const bump = (map: Record<string, number>, id: string) => ({ ...map, [id]: (map[id] ?? 0) + 1 });

export const useThesisDocStore = create<ThesisDocState>((set, get) => {
  const setPending = (thesisId: string, n: number) =>
    set((s) => ({ pending: { ...s.pending, [thesisId]: n } }));

  // Flush the thesis's queue strictly in order. Head-of-line blocking is the
  // POINT: a retrying op must hold back later ops or replays land out of order
  // (indices are positional). One pump runs per thesis at a time.
  const runPump = async (thesisId: string): Promise<void> => {
    const p = pumpFor(thesisId);
    if (p.running) return;
    p.running = true;
    try {
      while (p.queue.length > 0) {
        const item = p.queue[0];
        try {
          const res = await executeOp(thesisId, item.op);
          await confirmOp(item.id);
          // Remove by identity (not blind shift) — belt-and-braces against any
          // future path that mutates the queue while this op was in flight.
          const at = p.queue.indexOf(item);
          if (at >= 0) p.queue.splice(at, 1);
          setPending(thesisId, p.queue.length);
          if (p.queue.length === 0) {
            // Only the LAST op reconciles with authoritative state — reconciling
            // mid-queue would wipe the later ops' optimistic patches (flicker).
            if (res && typeof res === "object" && "document" in res && res.document) {
              get().setDoc(thesisId, res.document);
              if ("history" in res && res.history) get().setHistoryState(thesisId, res.history);
            } else {
              try {
                const fetched = await getThesisDocument(thesisId);
                // A new op may have been enqueued during this fetch — its
                // optimistic patch must not be clobbered by the older snapshot.
                if (p.queue.length === 0) get().setDoc(thesisId, fetched);
              } catch {
                /* keep optimistic state; next revalidate reconciles */
              }
            }
            set((s) => ({ drainTick: bump(s.drainTick, thesisId) }));
          }
          item.resolve?.();
        } catch (e) {
          if (isRetryableError(e)) {
            // Offline / flaky network: keep the op (and its optimistic state),
            // back off, retry the SAME head. Reconnect wakes the sleep early.
            item.attempts++;
            void bumpOpAttempts(item.id);
            const delay = Math.min(2_000 * 2 ** Math.min(item.attempts - 1, 5), 60_000);
            await sleepWithWake(p, delay + Math.random() * 500);
          } else {
            // The server REJECTED the op — the doc changed under us (AI edit,
            // other device). Later queued ops carry indices computed on top of
            // this one → all poisoned. Drop the queue and re-fetch server truth.
            const dropped = p.queue.splice(0);
            await clearQueuedOps(thesisId);
            setPending(thesisId, 0);
            for (const d of dropped) d.reject?.(e);
            Alert.alert(
              i18n.t("common.error", { defaultValue: "Error" }),
              i18n.t("workspace.editsRejected", {
                defaultValue: "Some edits couldn't be saved because the document changed. It has been reloaded.",
              }),
            );
            void get().revalidate(thesisId);
            // Earlier ops in this batch may have landed before the rejected one —
            // the server bytes changed, so the editor config must refresh too.
            set((s) => ({ drainTick: bump(s.drainTick, thesisId) }));
          }
        }
      }
    } finally {
      p.running = false;
    }
  };

  // Replay the durable queue on (re)open: re-apply unsent ops' patches onto the
  // hydrated doc so the user still sees their edits after an app kill, then flush.
  // Runs at most once per thesis per session; every pump start awaits it so disk
  // ops (older) always enter the queue before any in-session op is executed.
  const ensureRestored = (thesisId: string): Promise<void> => {
    let pr = restorePromises.get(thesisId);
    if (!pr) {
      pr = (async () => {
        const disk = await listQueuedOps(thesisId);
        if (disk.length === 0) return;
        const p = pumpFor(thesisId);
        const fresh = disk.filter((d) => !p.queue.some((q) => q.id === d.id));
        if (fresh.length === 0) return;
        // Disk ops predate anything enqueued this session — replay them FIRST.
        p.queue.unshift(...fresh.map((d) => ({ id: d.id, op: d.op, attempts: d.attempts })));
        setPending(thesisId, p.queue.length);
        const cur = get().byId[thesisId];
        if (cur?.available) {
          let doc = cur;
          for (const d of fresh) doc = applyOpToDoc(doc, d.op);
          set((s) => ({ byId: { ...s.byId, [thesisId]: doc } }));
        }
        void runPump(thesisId);
      })().catch(() => {});
      restorePromises.set(thesisId, pr);
    }
    return pr;
  };

  return {
    byId: {},
    tick: {},
    pending: {},
    drainTick: {},
    revalidating: {},
    history: {},

    hydrate: async (thesisId) => {
      // A doc already in memory is fresher than disk — don't clobber it.
      if (get().byId[thesisId]) return;
      const cached = await getDocCache(thesisId);
      if (cached && !get().byId[thesisId]) {
        set((s) => ({ byId: { ...s.byId, [thesisId]: cached }, tick: bump(s.tick, thesisId) }));
      }
    },

    revalidate: async (thesisId) => {
      if (get().revalidating[thesisId]) return;
      set((s) => ({ revalidating: { ...s.revalidating, [thesisId]: true } }));
      try {
        const doc = await getThesisDocument(thesisId);
        // Ops are mid-flight → their flush is the authoritative reconcile; a doc
        // fetched before they landed would be stale. Skip.
        if ((get().pending[thesisId] ?? 0) > 0) return;
        get().setDoc(thesisId, doc);
      } catch {
        // Keep whatever we last showed; only fall back to a legacy marker if we've
        // never had anything to render for this thesis.
        set((s) =>
          s.byId[thesisId]
            ? {}
            : { byId: { ...s.byId, [thesisId]: { docMode: "legacy-db", available: false } } },
        );
      } finally {
        set((s) => ({ revalidating: { ...s.revalidating, [thesisId]: false } }));
      }
    },

    load: async (thesisId) => {
      await get().hydrate(thesisId);
      await ensureRestored(thesisId);
      await get().revalidate(thesisId);
    },

    setDoc: (thesisId, doc) => {
      set((s) => ({ byId: { ...s.byId, [thesisId]: doc }, tick: bump(s.tick, thesisId) }));
      void setDocCache(thesisId, doc);
    },

    setHistoryState: (thesisId, h) =>
      set((s) => ({ history: { ...s.history, [thesisId]: h } })),

    refreshHistoryState: async (thesisId) => {
      try {
        const st = await getThesisHistory(thesisId);
        get().setHistoryState(thesisId, { canUndo: st.canUndo, canRedo: st.canRedo });
      } catch {
        // Endpoint missing (old server) or offline — leave buttons as they were.
      }
    },

    applyRestoredDoc: (thesisId, doc, h) => {
      get().setDoc(thesisId, doc);
      get().setHistoryState(thesisId, h);
      set((s) => ({ drainTick: bump(s.drainTick, thesisId) }));
    },

    mutate: (thesisId, op) => {
      // Optimistic: patch the live blocks now so the outline view updates
      // instantly. We do NOT bump `tick` — the server bytes haven't changed yet,
      // so the Word/PDF WebViews must not reload to still-stale bytes mid-edit.
      const cur = get().byId[thesisId];
      if (cur?.available) {
        set((s) => ({
          byId: { ...s.byId, [thesisId]: applyOpToDoc(cur, op) },
        }));
      }
      for (const l of opListeners) l(thesisId, op);

      const id = newOpId();
      const p = pumpFor(thesisId);
      const promise = new Promise<void>((resolve, reject) => {
        p.queue.push({ id, op, attempts: 0, resolve, reject });
      });
      // Fire-and-forget callers must not trip "unhandled rejection" when a
      // permanent failure is already surfaced via the Alert in the pump.
      promise.catch(() => {});
      setPending(thesisId, p.queue.length);

      // Durably persist BEFORE flushing, then flush (or cut a backoff short).
      // Gated on the one-shot disk restore so older queued ops always execute
      // before this one — the pump replays strictly in order.
      void Promise.all([enqueueOp(id, thesisId, op), ensureRestored(thesisId)]).finally(() => {
        if (p.wake) p.wake();
        void runPump(thesisId);
      });

      return promise;
    },
  };
});

// Reconnect → wake every backing-off pump so queued edits flush immediately.
// (A pump with a non-empty queue is always alive — either mid-request or in a
// backoff sleep — so cutting the sleep short is all a reconnect needs to do.)
NetInfo.addEventListener((state) => {
  if (!(state.isConnected ?? true)) return;
  for (const p of pumps.values()) {
    if (p.queue.length > 0 && p.wake) p.wake();
  }
});
