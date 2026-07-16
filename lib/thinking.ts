// Pure helpers for the ThinkingTrace widget. No React/RN imports so they can be
// verified with `npx tsx lib/thinking.check.ts`.

/** Reasoning duration in ms, or undefined if it can't be measured yet. */
export function deriveThinkingMs(msg: {
  thinkingStartedAt?: string;
  thinkingEndedAt?: string;
}): number | undefined {
  if (!msg.thinkingStartedAt || !msg.thinkingEndedAt) return undefined;
  const ms = Date.parse(msg.thinkingEndedAt) - Date.parse(msg.thinkingStartedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

/** The last `n` non-empty, trimmed lines of the reasoning text. */
export function windowLines(text: string, n: number): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return n > 0 ? lines.slice(-n) : lines;
}

/** Human duration for the chip: "1s" (min) … "45s" … "1m 4s". */
export function formatThinkingDuration(ms: number): string {
  const secs = Math.max(1, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}
