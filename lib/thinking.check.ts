import assert from "node:assert";
import { deriveThinkingMs, windowLines, formatThinkingDuration } from "./thinking";

// deriveThinkingMs
assert.strictEqual(deriveThinkingMs({}), undefined, "no timestamps → undefined");
assert.strictEqual(
  deriveThinkingMs({ thinkingStartedAt: "2026-07-16T00:00:00.000Z" }),
  undefined,
  "only start → undefined",
);
assert.strictEqual(
  deriveThinkingMs({
    thinkingStartedAt: "2026-07-16T00:00:00.000Z",
    thinkingEndedAt: "2026-07-16T00:00:08.000Z",
  }),
  8000,
  "both → delta ms",
);
assert.strictEqual(
  deriveThinkingMs({
    thinkingStartedAt: "2026-07-16T00:00:08.000Z",
    thinkingEndedAt: "2026-07-16T00:00:00.000Z",
  }),
  undefined,
  "negative → undefined",
);

// windowLines
assert.deepStrictEqual(windowLines("", 6), [], "empty → []");
assert.deepStrictEqual(windowLines("a\n\n b \nc", 6), ["a", "b", "c"], "trims + drops empties");
assert.deepStrictEqual(windowLines("1\n2\n3\n4", 2), ["3", "4"], "keeps last n");

// formatThinkingDuration
assert.strictEqual(formatThinkingDuration(0), "1s", "floors to 1s");
assert.strictEqual(formatThinkingDuration(500), "1s", "sub-second → 1s");
assert.strictEqual(formatThinkingDuration(45_000), "45s");
assert.strictEqual(formatThinkingDuration(60_000), "1m");
assert.strictEqual(formatThinkingDuration(64_000), "1m 4s");

console.log("OK: lib/thinking.ts");
