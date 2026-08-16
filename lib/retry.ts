// Repeating work that failed for a reason that passes.
//
// A student writing a thesis on Algerian mobile data meets several failures per
// session that have nothing to do with what they asked: the phone hands over
// between cells, the model provider is at capacity ("the service is very busy
// right now"), the proxy in front of the API times out. Every one of them ended
// as a dead bubble with a Retry button under it — and what people actually do
// with that button is tap it, or retype the question, until one lands.
//
// So the app taps it for them. These are the two decisions that takes: which
// failures are worth repeating, and how long to wait before repeating them.
//
// The rule that keeps this honest is NOT here, because it belongs to the caller:
// only work that produced nothing may be retried. Anything that already reached
// the student — text in a bubble, an edited .docx — is finished, right or wrong,
// and running it again would duplicate it. See runAssistantTurn.

/**
 * Total tries for one AI turn: the first attempt plus three quiet retries.
 *
 * Four is the number of failures a student can sit through without the wait
 * becoming worse than the error — roughly 13 seconds of backoff on top of
 * whatever the attempts themselves cost.
 */
export const MAX_TURN_ATTEMPTS = 4;

// Waits between attempts. The first (~1s) is for a dropped socket, which is
// usually gone by the time the phone finishes the handover; the last (~8s) is
// for a provider at capacity, whose rate window needs real time to reopen.
const BACKOFF_MS = [1_200, 3_500, 8_000];

/** How long to wait after `failedAttempt` (1-based) before trying again. */
export function backoffMs(failedAttempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(failedAttempt, 1), BACKOFF_MS.length) - 1];
}

// HTTP statuses that mean "not now" rather than "no". 429 is the provider at
// capacity — the one this was written for. 408/425 are timeouts, 5xx is the API
// box or the proxy in front of it, and 502/504 is exactly what a server
// restarting mid-deploy looks like from a phone.
//
// Everything else is a REFUSAL: a 400 with bad arguments, a 401 whose session
// expired, a 402 for a student key with no credit left. Repeating those spends
// the student's time to be told the same thing four times.
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524, 529]);

// A cancel is not a failure — the user hit Stop, or a newer turn took over. RN's
// fetch and expo/fetch disagree on the shape (an AbortError, a plain Error whose
// message says "Aborted", our own "Canceled" from the upload path), so both the
// name and the text are checked.
function isAbort(e: unknown): boolean {
  if ((e as { name?: string } | null)?.name === "AbortError") return true;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return /\baborted?\b|\bcancell?ed\b/i.test(msg);
}

/**
 * Is this failure worth repeating?
 *
 * An error carrying an HTTP status is judged on the status alone — the server
 * answered, and its answer says whether asking again could ever work. An error
 * with no status never got an HTTP answer at all (DNS, a refused connection, a
 * socket that died mid-body), and those are precisely the ones a second attempt
 * fixes, so they default to retryable.
 */
export function isTransientFailure(e: unknown): boolean {
  if (isAbort(e)) return false;
  const status = (e as { status?: number } | null | undefined)?.status;
  if (typeof status === "number") return TRANSIENT_STATUS.has(status);
  return true;
}

/**
 * Wait `ms`, but give up the moment `live()` goes false.
 *
 * A backoff is dead time the student can walk into, and Stop has to end the turn
 * in the tick it is pressed (see chat-store.stopGenerating) — not eight seconds
 * later when a timer happens to fire. Ticking in short steps costs nothing and
 * means the longest a cancelled turn can linger here is one tick.
 */
export async function backoffSleep(ms: number, live: () => boolean): Promise<void> {
  const TICK = 200;
  for (let waited = 0; waited < ms; waited += TICK) {
    if (!live()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(TICK, ms - waited)));
  }
}
