import { create } from "zustand";
import { fetchQuota, fetchPlanCatalogue } from "@/lib/api";
import type { QuotaState, PlanCatalogue, QuotaDenyReason, ThesisAllowance } from "@/types/billing";

// The message counter and the paywall it raises.
//
// ⚠️ Select PRIMITIVES from this store, never a fresh object literal —
// `useBillingStore(s => ({a: s.a}))` returns a new reference every render and
// throws "Maximum update depth exceeded". `useQuotaAvailable()` below exists so
// the common read is a primitive by construction.

interface BillingState {
  quota: QuotaState | null;
  /**
   * How many theses the plan allows, and how many are already held. A free
   * student may hold ONE.
   *
   * Its own field rather than a member of `quota`: every chat turn echoes a fresh
   * QuotaState back through `applyQuota`, and that payload is the message ledger
   * only — a thesis count living inside it would be blanked by the first message
   * the student sent.
   */
  thesisAllowance: ThesisAllowance | null;
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
  /**
   * The student closed the "nearly out" warning.
   *
   * It needs its own flag: that warning is shown from the DERIVED `useQuotaLow`
   * (a threshold on `available`), so there was nothing for its × to clear — it
   * called `setBlocked(null)`, which is already null whenever the warning is the
   * thing on screen, and the card could not be dismissed at all.
   *
   * Retired the moment the count climbs back out of the low band (a top-up, a
   * renewal, a new month), so the next run-down warns again. Session-scoped —
   * being genuinely blocked raises its own card, which is never dismissible.
   */
  lowDismissed: boolean;

  refreshQuota: () => Promise<void>;
  refreshCatalogue: () => Promise<void>;
  /** Both, for a screen that needs the counter AND the prices. */
  refreshAll: () => Promise<void>;
  /** Apply a quota snapshot the server sent back on a turn — no round-trip. */
  applyQuota: (quota: QuotaState | null | undefined) => void;
  setBlocked: (reason: QuotaDenyReason | null, quota?: QuotaState | null) => void;
  /** Close the "nearly out" warning. Not the blocked card — that one stays. */
  dismissLow: () => void;
  /**
   * Optimistically spend one message so the counter moves the instant the
   * student sends, instead of a beat later when the turn returns. The server
   * remains the authority — every turn echoes the real state back, and a failed
   * turn is refunded there, which `applyQuota` then reflects.
   */
  spendOne: () => void;
  /**
   * A thesis was just created — count it, without a round trip.
   *
   * So the next tap on "new thesis" is refused by the screen rather than by the
   * server: the four creation flows all land somewhere else afterwards (the
   * writer, the analysis screen), and none of them refreshes the counter.
   */
  noteThesisCreated: () => void;
  /**
   * The server refused a creation with the counts it refused on. Trusted over
   * whatever was cached — the cache is why the student got that far.
   */
  applyThesisLimit: (limit: { plan?: string; limit?: number | null; used?: number }) => void;
}

/** The band `useQuotaLow` warns inside — see the selector for why a threshold. */
const LOW_AT = 3;

/**
 * Does a dismissal of the "nearly out" warning still hold, given a fresh count?
 *
 * Only while the count is still inside the low band. A count that has climbed
 * back out means the student topped up or a new month started, so the next time
 * they run low the warning has something new to say and must be shown again.
 */
const keepsDismissal = (dismissed: boolean, quota: QuotaState | null | undefined): boolean => {
  if (!dismissed) return false;
  const a = quota?.available;
  return a !== undefined && a >= 0 && a <= LOW_AT;
};

export const useBillingStore = create<BillingState>((set, get) => ({
  quota: null,
  thesisAllowance: null,
  catalogue: null,
  loading: false,
  catalogueFailed: false,
  blockedReason: null,
  lowDismissed: false,

  refreshQuota: async () => {
    set({ loading: true });
    try {
      const { theses, ...quota } = await fetchQuota();
      set({
        quota,
        lowDismissed: keepsDismissal(get().lowDismissed, quota),
        // A server that predates the thesis limit sends nothing here. Keep the
        // last-known allowance rather than replacing it with null, which the
        // screens read as "unknown" and would silently stop enforcing.
        ...(theses ? { thesisAllowance: theses } : null),
      });
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
    set({
      quota,
      blockedReason: quota.available > 0 ? null : get().blockedReason,
      lowDismissed: keepsDismissal(get().lowDismissed, quota),
    });
  },

  setBlocked: (reason, quota) => {
    set(
      quota
        ? { blockedReason: reason, quota, lowDismissed: keepsDismissal(get().lowDismissed, quota) }
        : { blockedReason: reason },
    );
  },

  dismissLow: () => set({ lowDismissed: true }),

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

  noteThesisCreated: () => {
    const a = get().thesisAllowance;
    if (!a) return;
    const used = a.used + 1;
    set({
      thesisAllowance: {
        ...a,
        used,
        remaining: a.limit === null ? null : Math.max(0, a.limit - used),
        canCreate: a.limit === null || used < a.limit,
      },
    });
  },

  applyThesisLimit: ({ plan, limit, used }) => {
    const a = get().thesisAllowance;
    const nextLimit = limit !== undefined ? limit : (a?.limit ?? null);
    const nextUsed = used ?? a?.used ?? 0;
    set({
      thesisAllowance: {
        plan: (plan as ThesisAllowance["plan"]) ?? a?.plan ?? "free",
        limit: nextLimit,
        used: nextUsed,
        remaining: nextLimit === null ? null : Math.max(0, nextLimit - nextUsed),
        // The server just said no. Never re-derive that from the counts — a
        // disagreement between them is exactly the bug this line prevents.
        canCreate: false,
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

/**
 * Whether another thesis may be created. TRUE while unknown — the server is the
 * authority on this and refuses at all four creation doors, so an unread counter
 * must never be the thing that stops a student who is entitled.
 */
export const useCanCreateThesis = () => useBillingStore((s) => s.thesisAllowance?.canCreate ?? true);
/** Theses the plan allows. -1 = unknown, 0 = unlimited (nothing to say). */
export const useThesisLimit = () =>
  useBillingStore((s) => {
    const a = s.thesisAllowance;
    if (!a) return -1;
    return a.limit ?? 0;
  });
export const useThesesUsed = () => useBillingStore((s) => s.thesisAllowance?.used ?? -1);
export const usePaymentsEnabled = () => useBillingStore((s) => s.catalogue?.paymentsEnabled ?? false);

/**
 * Whether to warn the student that they are nearly out.
 *
 * Deliberately a threshold rather than a percentage: on the free plan 20% of 5
 * is 1, which is too late to be a warning, and on a 1,800-message pooled plan
 * 20% is 360, which is noise.
 *
 * Closing the warning has to be answered HERE, not just in the card: this is
 * what decides whether it is on screen, so a card that only cleared its own
 * state stayed exactly where it was.
 */
export const useQuotaLow = () =>
  useBillingStore((s) => {
    const a = s.quota?.available;
    if (a === undefined || a < 0 || a > LOW_AT) return false;
    return !s.lowDismissed;
  });
