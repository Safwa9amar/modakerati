import { create } from "zustand";
import { fetchQuota, fetchPlanCatalogue } from "@/lib/api";
import type { QuotaState, PlanCatalogue, QuotaDenyReason } from "@/types/billing";

// The message counter and the paywall it raises.
//
// ⚠️ Select PRIMITIVES from this store, never a fresh object literal —
// `useBillingStore(s => ({a: s.a}))` returns a new reference every render and
// throws "Maximum update depth exceeded". `useQuotaAvailable()` below exists so
// the common read is a primitive by construction.

interface BillingState {
  quota: QuotaState | null;
  catalogue: PlanCatalogue | null;
  loading: boolean;
  /**
   * The catalogue request failed and there is nothing to show.
   *
   * Tracked separately from `catalogue === null` because the two mean different
   * things to the paywall: null-and-loading is a spinner, null-and-FAILED needs
   * an explanation and a retry. Conflating them is how the screen ended up
   * spinning forever against a server without the route.
   */
  catalogueFailed: boolean;
  /**
   * Set when the server refuses a turn for want of quota. The chat reads this to
   * raise the paywall instead of leaving a dead bubble; clearing it dismisses.
   */
  blockedReason: QuotaDenyReason | null;

  refreshQuota: () => Promise<void>;
  refreshCatalogue: () => Promise<void>;
  /** Both, for a screen that needs the counter AND the prices. */
  refreshAll: () => Promise<void>;
  /** Apply a quota snapshot the server sent back on a turn — no round-trip. */
  applyQuota: (quota: QuotaState | null | undefined) => void;
  setBlocked: (reason: QuotaDenyReason | null, quota?: QuotaState | null) => void;
  /**
   * Optimistically spend one message so the counter moves the instant the
   * student sends, instead of a beat later when the turn returns. The server
   * remains the authority — every turn echoes the real state back, and a failed
   * turn is refunded there, which `applyQuota` then reflects.
   */
  spendOne: () => void;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  quota: null,
  catalogue: null,
  loading: false,
  catalogueFailed: false,
  blockedReason: null,

  refreshQuota: async () => {
    set({ loading: true });
    try {
      set({ quota: await fetchQuota() });
    } catch {
      // A counter that can't be read is not worth an error screen — the send
      // path still gets the authoritative answer from the server.
    } finally {
      set({ loading: false });
    }
  },

  refreshCatalogue: async () => {
    set({ catalogueFailed: false });
    try {
      set({ catalogue: await fetchPlanCatalogue(), catalogueFailed: false });
    } catch {
      // Never invent prices — but never spin forever either. The screen shows
      // an explanation and a retry, which is also the honest answer when the
      // server predates this endpoint.
      set({ catalogueFailed: true });
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshQuota(), get().refreshCatalogue()]);
  },

  applyQuota: (quota) => {
    if (!quota) return;
    // A fresh reading always clears the block: the student may have just paid.
    set({ quota, blockedReason: quota.available > 0 ? null : get().blockedReason });
  },

  setBlocked: (reason, quota) => {
    set(quota ? { blockedReason: reason, quota } : { blockedReason: reason });
  },

  spendOne: () => {
    const q = get().quota;
    if (!q) return;
    // Spend the allowance first, then bought credit — mirroring the server, so
    // the optimistic number matches what comes back.
    const remaining = Math.max(0, q.remaining - 1);
    const topupRemaining = q.remaining > 0 ? q.topupRemaining : Math.max(0, q.topupRemaining - 1);
    set({
      quota: {
        ...q,
        used: q.used + 1,
        remaining,
        topupRemaining,
        available: Math.max(0, q.available - 1),
      },
    });
  },
}));

// ── primitive selectors ──────────────────────────────────────────────────────
// Each returns a number/boolean/string, so a component re-renders only when the
// value it actually uses changes.

/** Messages the student can send right now. -1 while unknown (hide the chip). */
export const useQuotaAvailable = () => useBillingStore((s) => s.quota?.available ?? -1);
export const useQuotaIncluded = () => useBillingStore((s) => s.quota?.included ?? 0);
export const useQuotaPlan = () => useBillingStore((s) => s.quota?.plan ?? "free");
export const useQuotaIsTrial = () => useBillingStore((s) => s.quota?.isTrial ?? false);
export const useQuotaBlocked = () => useBillingStore((s) => s.blockedReason);
export const usePaymentsEnabled = () => useBillingStore((s) => s.catalogue?.paymentsEnabled ?? false);

/**
 * Whether to warn the student that they are nearly out.
 *
 * Deliberately a threshold rather than a percentage: on the free plan 20% of 5
 * is 1, which is too late to be a warning, and on a 1,800-message pooled plan
 * 20% is 360, which is noise.
 */
export const useQuotaLow = () =>
  useBillingStore((s) => {
    const a = s.quota?.available;
    return a !== undefined && a >= 0 && a <= 3;
  });
