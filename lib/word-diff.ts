// Word-level diff between two paragraph versions, for the suggestion
// compare view (removed words struck in the original slip, added words
// tinted in the proposed text). Tokenizes on whitespace — word-safe for
// Arabic (letters join only within a word) — and runs a classic LCS.
//
// Perf cap: past MAX_TOKENS on either side we skip the O(n·m) table and
// return the degenerate two-segment diff; the UI then shows the plain
// original without word marks (still perfectly usable).

export type DiffKind = "same" | "del" | "add";

export interface DiffSegment {
  text: string;
  kind: DiffKind;
}

const MAX_TOKENS = 400;

export function diffWords(oldText: string, newText: string): DiffSegment[] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    const segs: DiffSegment[] = [];
    if (a.length) segs.push({ text: a.join(" "), kind: "del" });
    if (b.length) segs.push({ text: b.join(" "), kind: "add" });
    return segs;
  }

  // LCS length table, row-major over (n+1)×(m+1). Uint16 is safe: lengths
  // are capped at MAX_TOKENS (< 65535).
  const n = a.length;
  const m = b.length;
  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] =
        a[i] === b[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }

  // Walk the table, merging adjacent tokens of the same kind into one
  // segment (joined with single spaces — original whitespace is not
  // preserved; the render layer only needs words in order).
  const segs: DiffSegment[] = [];
  const push = (kind: DiffKind, word: string) => {
    const last = segs[segs.length - 1];
    if (last && last.kind === kind) last.text += " " + word;
    else segs.push({ text: word, kind });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      push("del", a[i]);
      i++;
    } else {
      push("add", b[j]);
      j++;
    }
  }
  while (i < n) push("del", a[i++]);
  while (j < m) push("add", b[j++]);
  return segs;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}
