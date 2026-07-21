import type { DocBlockDTO } from "@/lib/api";
import { normalize, normalizeWithMap } from "./text-normalize";

/** One exact hit: a span in the ORIGINAL text of block `blockIndex`. For
 * table/image blocks the span indexes the flattened text and is unused (those
 * hits are jump-only — no highlight, no replace). */
export type SearchMatch = {
  blockIndex: number;
  start: number;
  end: number;
  kind: DocBlockDTO["kind"];
};

export const MIN_QUERY = 2; // 1-char queries are noise (thousands of hits)
export const MAX_MATCHES = 500; // perf guard; the counter shows "500+" when hit

/** The searchable text of a block (same extraction as GlobalDockBar's textOf). */
export function blockSearchText(b: DocBlockDTO): string {
  if (b.kind === "paragraph") return b.text;
  if (b.kind === "image") return b.caption ?? "";
  if (b.kind === "table") return b.rows.flat().join(" ");
  return "";
}

export function computeMatches(
  blocks: DocBlockDTO[],
  rawQuery: string,
): { matches: SearchMatch[]; capped: boolean } {
  const q = normalize(rawQuery);
  if (q.length < MIN_QUERY) return { matches: [], capped: false };
  const matches: SearchMatch[] = [];
  for (const b of blocks) {
    const text = blockSearchText(b);
    if (!text) continue;
    const { norm, map } = normalizeWithMap(text);
    let from = 0;
    while (true) {
      const j = norm.indexOf(q, from);
      if (j === -1) break;
      const start = map[j];
      // End extends to the start of the NEXT normalized char, so trailing
      // folded-away diacritics stay inside the span (replace must eat them).
      const end = j + q.length < map.length ? map[j + q.length] : text.length;
      matches.push({ blockIndex: b.index, start, end, kind: b.kind });
      from = j + q.length;
      if (matches.length >= MAX_MATCHES) return { matches, capped: true };
    }
  }
  return { matches, capped: false };
}
