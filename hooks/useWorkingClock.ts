// The shared "is the AI still working?" clock. Only React + pure helpers, no RN
// imports — the Lexical DOM bundle (components/workspace/lexical/*) uses it too.

import { useEffect, useState } from "react";
import { workingStage } from "@/lib/thinking";

export interface WorkingClock {
  /** How long the request has been running, ms. */
  elapsedMs: number;
  /** Which wait line to show — see workingStage. */
  stage: "short" | "long" | "veryLong";
}

// Below this much silence something IS visibly arriving, and that is already the
// indicator. Only past it does a surface need to say it's still working.
export const WORKING_QUIET_MS = 2500;

/**
 * Elapsed time + wait stage for a running AI request, or null when there is
 * nothing to say (idle, or text is still streaming in).
 *
 * Timestamps come from wherever the surface already has them: the chat passes
 * the store's `turnStartedAt`/`lastEventAt`; the inline suggestion surfaces own
 * no timestamps, so they omit both and pass `stream` instead — the clock then
 * starts when `active` flips true and treats every change of that text as the
 * request proving it's alive.
 *
 * Call it unconditionally: the loading UI it feeds usually sits behind an early
 * return, and it ticks on its own so the note can appear DURING a silence, when
 * by definition nothing else is re-rendering.
 */
export function useWorkingClock({
  active,
  startedAt,
  lastEventAt,
  stream,
}: {
  active: boolean;
  startedAt?: number | null;
  lastEventAt?: number | null;
  stream?: string;
}): WorkingClock | null {
  const [now, setNow] = useState(0);
  const [localStart, setLocalStart] = useState<number | null>(null);
  const [localEvent, setLocalEvent] = useState(0);

  useEffect(() => {
    if (!active) {
      setLocalStart(null);
      return;
    }
    const t = Date.now();
    setLocalStart(t);
    setLocalEvent(t);
    setNow(t);
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Only meaningful in the `stream` mode; harmless (and unused) otherwise.
  useEffect(() => {
    if (active) setLocalEvent(Date.now());
  }, [active, stream]);

  const start = startedAt ?? localStart;
  const last = lastEventAt ?? localEvent;
  if (!active || start == null) return null;
  if (now - last < WORKING_QUIET_MS) return null;
  const elapsedMs = Math.max(0, now - start);
  return { elapsedMs, stage: workingStage(elapsedMs) };
}
