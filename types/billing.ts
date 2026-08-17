// Billing shapes, mirroring the server's lib/billing + routes/payment.
//
// The unit the student sees is a MESSAGE — one question they asked, however many
// model and tool calls ran behind it. Nothing here talks about tokens: the
// server's token valve is a cost guard, not something a student can act on.

export type PlanCode = "free" | "monthly" | "quarterly" | "semiannual";

export interface PlanOffer {
  code: PlanCode;
  priceDzd: number;
  months: number;
  messages: number;
  /** Ceiling per month inside a pooled multi-month plan. null on 1-month plans. */
  monthlyCap: number | null;
  theses: number | null;
  pricePerMonthDzd: number;
}

export interface PlanCatalogue {
  currency: string;
  plans: PlanOffer[];
  free: { messages: number; trialMessages: number; theses: number | null };
  topup: { messages: number; priceDzd: number };
  /** False when the server has no gateway key — hide the buy buttons entirely. */
  paymentsEnabled: boolean;
}

export interface QuotaState {
  plan: PlanCode;
  periodStart: string;
  periodEnd: string;
  /** The allowance for this period (the one-time 30 on a brand-new account). */
  included: number;
  used: number;
  remaining: number;
  /** Bought messages, spent only once `remaining` hits 0. Never expire. */
  topupRemaining: number;
  /** What can actually be sent right now. This is the number to show. */
  available: number;
  isTrial: boolean;
  monthly?: { cap: number; used: number; remaining: number; resetsAt: string };
}

/**
 * How many theses this account may hold, and whether there is room for one more.
 *
 * A free student may hold ONE. Deliberately NOT folded into `QuotaState`: that
 * shape is echoed back by every chat turn (`applyQuota`), and it carries only the
 * message ledger — a thesis field living inside it would be wiped clean the first
 * time the student sent a message.
 */
export interface ThesisAllowance {
  plan: PlanCode;
  /** null = unlimited (the 3- and 6-month plans). */
  limit: number | null;
  used: number;
  remaining: number | null;
  canCreate: boolean;
}

/** GET /api/payment/quota — the message counter plus the thesis allowance. */
export interface QuotaResponse extends QuotaState {
  /** Absent on a server that predates the thesis limit. */
  theses?: ThesisAllowance;
}

export interface SubscriptionState {
  plan: PlanCode;
  status: string;
  gateway: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  periodMonths: number;
  priceDzd: number;
  cancelAt: string | null;
  quota: QuotaState;
}

/** Why the server refused a turn. Mirrors DenyReason on the server. */
export type QuotaDenyReason = "period-exhausted" | "month-cap" | "token-valve";

/**
 * A turn refused for want of quota.
 *
 * Carried on the thrown Error so the chat can raise the paywall instead of
 * leaving a dead bubble with a Retry button that can never succeed.
 */
export interface QuotaError extends Error {
  status: 402;
  code: "quota_exhausted";
  reason?: QuotaDenyReason;
  quota?: QuotaState;
}

export function isQuotaError(e: unknown): e is QuotaError {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "quota_exhausted";
}

/**
 * A thesis refused because the plan is already holding as many as it allows.
 *
 * Also a 402, and it comes from all four creation doors — the wizard, a .docx
 * import, a combine, and the assistant's own create_thesis — so every one of them
 * can be answered with the same wording.
 */
export interface ThesisLimitError extends Error {
  status: 402;
  code: "thesis_limit";
  plan?: PlanCode;
  limit?: number | null;
  used?: number;
}

export function isThesisLimitError(e: unknown): e is ThesisLimitError {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "thesis_limit";
}
